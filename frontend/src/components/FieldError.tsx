export function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <div id={id} className="error" role="alert">{message}</div> : null
}
