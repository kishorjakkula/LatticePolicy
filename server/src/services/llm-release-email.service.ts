import nodemailer from 'nodemailer'
import { z } from 'zod'
import { withTenantTx, toRawQuery } from '../db.js'

export function isLlmEmailEnabled(): boolean {
  return process.env.LLM_EMAIL_ENABLED === 'true'
}

export async function sendLlmReleaseEmail(
  tenantId: string,
  notificationId: string,
  attempt: number,
  maxAttempts: number,
  send?: (message: {
    from: string
    to: string
    subject: string
    text: string
    messageId: string
  }) => Promise<{ messageId: string; accepted?: unknown[] }>,
) {
  z.string().uuid().parse(notificationId)
  const notification = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q(
      `SELECT n.*, c.email AS current_email FROM notification_intents n
      LEFT JOIN llm_release_contacts c ON c.tenant_id=n.tenant_id AND c.user_id=(n.payload->>'recipientUserId')::uuid
      WHERE n.tenant_id=$1 AND n.notification_id=$2 AND n.event_type='LLM_CANDIDATE_READY'`,
      [tenantId, notificationId],
    )
    const row = result.rows[0]
    if (!row) throw new Error('Technical-admin notification not found')
    if (row.status === 'Sent' || row.status === 'Suppressed') return null
    // Complete the outbox delivery without sending or scheduling another retry.
    if (!isLlmEmailEnabled()) {
      await q(
        `UPDATE notification_intents SET status='Suppressed',last_error='LLM email disabled (LLM_EMAIL_ENABLED is not true)' WHERE tenant_id=$1 AND notification_id=$2`,
        [tenantId, notificationId],
      )
      return null
    }
    // Recheck authority at delivery time; role revocation must stop future mail.
    const valid = await q(
      `SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.user_id
      JOIN rbac_roles r ON r.tenant_id=u.tenant_id AND r.role_code=ur.role_code AND r.active=true
      WHERE u.tenant_id=$1 AND u.user_id=$2 AND u.disabled=false AND ur.role_code='carrier_technical_admin'`,
      [tenantId, row.payload.recipientUserId],
    )
    if (!valid.rowCount || !row.current_email) {
      await q(
        `UPDATE notification_intents SET status='Suppressed',last_error='Recipient is no longer a configured technical administrator' WHERE tenant_id=$1 AND notification_id=$2`,
        [tenantId, notificationId],
      )
      return null
    }
    return row
  })
  if (!notification) return
  try {
    const host = process.env.LLM_SMTP_HOST
    const from = z.string().email().parse(process.env.LLM_SMTP_FROM)
    if (!send && !host) throw new Error('not configured')
    const port = Number(process.env.LLM_SMTP_PORT || 587)
    if (![465, 587].includes(port)) throw new Error('TLS SMTP port required')
    const transport = send
      ? null
      : nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          requireTLS: true,
          auth: process.env.LLM_SMTP_USER
            ? {
                user: process.env.LLM_SMTP_USER,
                pass: process.env.LLM_SMTP_PASSWORD,
              }
            : undefined,
          tls: { rejectUnauthorized: true },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
          logger: false,
          debug: false,
          disableFileAccess: true,
          disableUrlAccess: true,
        })
    const message = {
      from,
      to: notification.current_email,
      subject: notification.subject,
      text: notification.body,
      messageId: `<llm-${notificationId}@latticepolicy.local>`,
    }
    const result = send
      ? await send(message)
      : await transport!.sendMail(message)
    if (!result.accepted?.length) throw new Error('not accepted')
    await withTenantTx(tenantId, async (db) =>
      toRawQuery(db)(
        `UPDATE notification_intents SET status='Sent',attempts=$3,last_attempt_at=now(),sent_at=now(),last_error=NULL,provider='smtp',provider_message_id=$4,recipient=$5::jsonb WHERE tenant_id=$1 AND notification_id=$2`,
        [
          tenantId,
          notificationId,
          attempt,
          result.messageId,
          JSON.stringify({ email: notification.current_email }),
        ],
      ),
    )
  } catch {
    await withTenantTx(tenantId, async (db) =>
      toRawQuery(db)(
        `UPDATE notification_intents SET status=$3,attempts=$4,last_attempt_at=now(),last_error='Technical-admin email delivery failed; check SMTP configuration' WHERE tenant_id=$1 AND notification_id=$2`,
        [
          tenantId,
          notificationId,
          attempt >= maxAttempts ? 'Failed' : 'Queued',
          attempt,
        ],
      ),
    )
    throw new Error(
      'Technical-admin email delivery failed; check SMTP configuration',
    )
  }
}
