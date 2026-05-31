import {
  useLocation as Ge,
  useNavigate as Qe,
  useParams as Ye,
  Link as se,
} from "react-router-dom";
import * as v from "react";
import * as e from "react/jsx-runtime";
import { api as Ze, apiDetails as et } from "../../api/client";
import {
  usePolicy as at,
  usePolicyVersions as st,
  useFullPolicy as rt,
  usePolicyTimeline as it,
  usePolicyAiInsights as ct,
  useIssuePolicyMutation as ot,
  useReinstatePolicyMutation as lt,
  useNonRenewPolicyMutation as dt,
  useReserveTransactionNumberMutation as ut,
} from "../../api/hooks";
import { TablePagination as Ce } from "../../components/TablePagination";
import { useClientPagination as we } from "../../hooks/useClientPagination";
import { normalizePayloadCoverages as ge } from "../wizard/coverageUtils";
import {
  clearPendingTransaction as re,
  readPendingTransactions as mt,
  savePendingTransaction as pt,
} from "../wizard/pendingEndorsement";
import {
  derivePolicyWorkflowStatus as Je,
  policyStatusBadgeColor as Xe,
} from "./statusModel";
import {
  formatDisplayDate as tt,
  formatDisplayDateTime as nt,
} from "../../shared/dateDisplay";
function je(n) {
  if (!n) return "";
  const t = new Date(n);
  if (!Number.isNaN(t.getTime())) return t.toISOString().slice(0, 10);
  const a = String(n),
    i = /^(\d{4}-\d{2}-\d{2})/.exec(a);
  return i ? i[1] : "";
}
function oe(n) {
  const t = String(n || "")
    .trim()
    .toLowerCase();
  return t === "cancel" || t === "cancelled" || t === "cancellation";
}
function Pe(n) {
  const t = String(n || "")
    .trim()
    .toLowerCase();
  return t === "reinstate" || t === "reinstated" || t === "reinstatement";
}
function yt(n) {
  const t = String(n || "")
    .trim()
    .toLowerCase();
  return t === "endorse" || t === "endorsement"
    ? "endorse"
    : t === "cancel" || t === "cancellation" || t === "cancelled"
      ? "cancel"
      : t === "reinstate" || t === "reinstatement" || t === "reinstated"
        ? "reinstate"
        : t === "rewrite" || t === "rewritten"
          ? "rewrite"
          : t === "renew" || t === "renewal" || t === "renewed"
            ? "renew"
            : "quote";
}
function Tt() {
  const { id: n } = Ye(),
    t = Ge(),
    a = Qe(),
    [i, l] = v.useState(null),
    [o, d] = v.useState(!1),
    [c, x] = v.useState("updatedDate"),
    [N, S] = v.useState("desc"),
    [u, m] = v.useState({
      endorse: null,
      cancel: null,
      reinstate: null,
      rewrite: null,
      renew: null,
    }),
    [p, w] = v.useState(!1),
    [A, I] = v.useState(!1),
    { data: r, refetch: V } = at(n ?? ""),
    { data: q, refetch: O } = st(n ?? ""),
    { data: Te, refetch: Ae } = rt(n ?? ""),
    { data: Re, isLoading: Ee, error: Q, refetch: ke } = it(n ?? ""),
    { data: Fe, error: J, refetch: $e } = ct(n ?? ""),
    le = ot(),
    Ue = lt(),
    Me = dt(),
    de = ut(),
    ue = q ?? [],
    me = Re ?? null,
    pe = Q ? String(Q.message || Q) : null,
    X = Fe?.aiInsights ?? null,
    B = J ? String(J.message || J) : null,
    ye = le.isPending,
    R = Te || r?.payload,
    U = ue.length ? ue : r?.versions || [],
    H = v.useMemo(() => jt(U), [U]),
    W = v.useMemo(() => {
      const s = Array.isArray(H) ? [...H] : [],
        h = N === "asc" ? 1 : -1,
        j = (y, f) => {
          const b = String(y || "")
              .trim()
              .toUpperCase(),
            C = String(f || "")
              .trim()
              .toUpperCase();
          return b === C ? 0 : b > C ? 1 : -1;
        },
        g = (y, f) => {
          const b = Number.isFinite(Date.parse(String(y || "")))
              ? Date.parse(String(y || ""))
              : 0,
            C = Number.isFinite(Date.parse(String(f || "")))
              ? Date.parse(String(f || ""))
              : 0;
          return b === C ? 0 : b > C ? 1 : -1;
        },
        Ne = (y, f) => {
          const b = Number(y || 0),
            C = Number(f || 0);
          return b === C ? 0 : b > C ? 1 : -1;
        };
      return (
        s.sort((y, f) => {
          let b = 0;
          return (
            c === "transactionNumber"
              ? (b = j(y?.transactionNumber, f?.transactionNumber))
              : c === "policyEffectiveDate"
                ? (b = g(y?.policyEffectiveDate, f?.policyEffectiveDate))
                : c === "effectiveDate"
                  ? (b = g(y?.effectiveDate, f?.effectiveDate))
                  : c === "expirationDate"
                    ? (b = g(y?.expirationDate, f?.expirationDate))
                    : c === "createdDate"
                      ? (b = g(
                          y?.createdDate || y?.processedDate,
                          f?.createdDate || f?.processedDate,
                        ))
                      : c === "updatedDate"
                        ? (b = g(
                            y?.updatedDate || y?.processedDate,
                            f?.updatedDate || f?.processedDate,
                          ))
                        : c === "updatedUser"
                          ? (b = j(y?.updatedUser, f?.updatedUser))
                          : c === "transactionType"
                            ? (b = j(y?.transactionType, f?.transactionType))
                            : c === "amount" &&
                              (b = Ne(
                                y?.premium?.total?.amount,
                                f?.premium?.total?.amount,
                              )),
            b * h
          );
        }),
        s
      );
    }, [H, c, N]),
    $ = we(W, 10);
  (v.useEffect(() => {
    if (t.hash === "#edit" && r) {
      const s = document.getElementById("policy-edit");
      s && s.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [t.hash, r]),
    v.useEffect(() => {
      if (!r?.policyId) {
        m({
          endorse: null,
          cancel: null,
          reinstate: null,
          rewrite: null,
          renew: null,
        });
        return;
      }
      m(mt(r.policyId));
    }, [r?.policyId]));
  const Z = () => {
      (V(), O(), Ae(), ke(), $e());
    },
    ze = async () => {
      if (r) {
        l(null);
        try {
          (await le.mutateAsync(r.policyId), Z());
        } catch (s) {
          l(s.message || String(s));
        }
      }
    },
    Le = async () => {
      if (!r) return;
      const s = ge(R || r.payload || {});
      (d(!0), l(null));
      try {
        const j =
          (await de.mutateAsync({ id: r.policyId, mode: "reinstate" }))
            ?.transactionNumber || "";
        (await Ue.mutateAsync({
          id: r.policyId,
          payload: {
            effectiveDate: new Date().toISOString().slice(0, 10),
            payload: s,
            transactionNumber: j || void 0,
          },
        }),
          re(r.policyId, "reinstate"),
          re(r.policyId, "rewrite"),
          m((g) => ({ ...g, reinstate: null, rewrite: null })),
          Z());
      } catch (h) {
        l(h.message || String(h));
      } finally {
        d(!1);
      }
    },
    Ve = async (s, h, j) => {
      if (r) {
        (I(!0), l(null));
        try {
          (await Me.mutateAsync({
            id: r.policyId,
            payload: { noticeDate: s, reasonCode: h, reason: j },
          }),
            w(!1),
            Z());
        } catch (g) {
          l(g.message || String(g));
        } finally {
          I(!1);
        }
      }
    },
    K = (s) => {
      r?.policyId && (re(r.policyId, s), m((h) => ({ ...h, [s]: null })));
    },
    _ = async (s) => {
      if (!r) return;
      const h = u[s],
        j = !!h?.quoteId;
      if (!R && !j) {
        l("Policy payload missing");
        return;
      }
      (d(!0), l(null));
      try {
        const g =
          s === "renew"
            ? je(r.term?.expirationDate) ||
              new Date().toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10);
        if (j && h) {
          const D = new URLSearchParams();
          (D.set("quoteId", h.quoteId),
            D.set("mode", s),
            D.set("policyId", r.policyId),
            r.policyNumber && D.set("policyNumber", r.policyNumber),
            h.transactionNumber &&
              D.set("transactionNumber", h.transactionNumber),
            D.set("effectiveDate", h.effectiveDate || g),
            a(`/wizard?${D.toString()}`));
          return;
        }
        const y =
          (await de.mutateAsync({ id: r.policyId, mode: s }))
            ?.transactionNumber || "";
        let f = R;
        const b = U.length ? U[U.length - 1]?.versionId : "";
        if (b)
          try {
            const D = await Ze.getVersionDetails(r.policyId, b);
            D?.payload && typeof D.payload == "object" && (f = D.payload);
          } catch {}
        if (!f) throw new Error("Policy payload missing");
        const C = ge(f),
          ae = await et.createQuoteDraft(C, {
            status: "Draft",
            progressStep: 1,
          }),
          F = new URLSearchParams();
        (F.set("quoteId", ae.quoteId),
          F.set("mode", s),
          F.set("policyId", r.policyId),
          r.policyNumber && F.set("policyNumber", r.policyNumber),
          y && F.set("transactionNumber", y),
          F.set("effectiveDate", g));
        const _e = pt({
          policyId: r.policyId,
          policyNumber: r.policyNumber,
          mode: s,
          quoteId: ae.quoteId,
          transactionNumber: y || void 0,
          effectiveDate: g,
        });
        (m((D) => ({
          ...D,
          [s]: _e || {
            policyId: r.policyId,
            policyNumber: r.policyNumber,
            mode: s,
            quoteId: ae.quoteId,
            transactionNumber: y || void 0,
            effectiveDate: g,
          },
        })),
          a(`/wizard?${F.toString()}`));
      } catch (g) {
        l(g.message || String(g));
      } finally {
        d(!1);
      }
    },
    qe = (s) => {
      const h = r?.policyId || n;
      if (!h || !s?.versionId) return;
      const j = new URLSearchParams();
      (j.set("readonly", "1"),
        j.set("policyId", h),
        r?.policyNumber && j.set("policyNumber", r.policyNumber),
        j.set("versionId", String(s.versionId)),
        j.set("mode", yt(s.transactionType)),
        s.transactionNumber &&
          j.set("transactionNumber", String(s.transactionNumber)));
      const g = je(s.effectiveDate);
      (g && j.set("effectiveDate", g), a(`/wizard?${j.toString()}`));
    },
    Oe = (s) =>
      s === "policyEffectiveDate" ||
      s === "effectiveDate" ||
      s === "expirationDate" ||
      s === "createdDate" ||
      s === "updatedDate" ||
      s === "amount"
        ? "desc"
        : "asc",
    P = (s) => {
      if (c === s) {
        S(N === "asc" ? "^" : "v");
        return;
      }
      (x(s), S(Oe(s)));
    },
    E = (s, h) => (c !== s ? h : `${h} ${N === "asc" ? "^" : "v"}`),
    Y = (s) => (c !== s ? "" : N === "asc" ? "^" : "v");
  if (i)
    return e.jsx("div", {
      className: "card",
      children: e.jsx("p", { className: "error", children: i }),
    });
  if (!r)
    return e.jsx("div", { className: "card", children: "Loading policy..." });
  const ee = String(r.internalStatus || r.status || ""),
    M = ee.toLowerCase(),
    z = H,
    te = z.length ? z[z.length - 1] : null,
    he = oe(te?.transactionType) || (!te && M === "cancelled"),
    fe = Je(ee, r.term),
    Be = gt(z),
    be = vt(z, r?.term) || te?.premium?.total || r?.premium?.total || null,
    k = r.customer && typeof r.customer == "object" ? r.customer : null,
    ne = String(k?.customerId || k?.customerKey || "").trim(),
    He = String(k?.firstName || "").trim(),
    We = String(k?.lastName || "").trim(),
    xe = String(k?.name || [He, We].filter(Boolean).join(" ").trim()).trim(),
    Ke = [
      String(k?.customerKey || "").trim() || String(k?.customerId || "").trim(),
      xe,
    ]
      .filter(Boolean)
      .join(" - ");
  return e.jsxs(e.Fragment, {
    children: [
      e.jsxs("div", {
        className: "ps-page-shell policy-shell",
        children: [
          e.jsxs("nav", {
            className: "ps-breadcrumbs",
            "aria-label": "Breadcrumb",
            children: [
              e.jsx(se, {
                to: "/dashboard",
                className: "ps-breadcrumb-link",
                children: "Home",
              }),
              e.jsx("span", {
                className: "ps-breadcrumb-sep",
                "aria-hidden": "true",
                children: "/",
              }),
              e.jsx(se, {
                to: "/search",
                className: "ps-breadcrumb-link",
                children: "Policies",
              }),
              e.jsx("span", {
                className: "ps-breadcrumb-sep",
                "aria-hidden": "true",
                children: "/",
              }),
              e.jsx("span", {
                className: "ps-breadcrumb-current",
                children: r.policyNumber,
              }),
            ],
          }),
          e.jsxs("div", {
            className: "card page-shell policy-hero",
            children: [
              e.jsx("div", {
                className: "policy-hero-kicker",
                children: "Policy workflow",
              }),
              e.jsxs("div", {
                className: "ps-page-header policy-page-header",
                children: [
                  e.jsxs("div", {
                    className: "policy-hero-main",
                    children: e.jsxs("h1", {
                      className: "ps-page-title",
                      children: [
                        "Policy ",
                        e.jsx("span", {
                          className: "id-mono",
                          children: r.policyNumber,
                        }),
                      ],
                    }),
                  }),
                  e.jsx("div", {
                    className: "ps-page-header-actions",
                    children: e.jsx("span", {
                      className: `badge ${Xe(fe)}`,
                      children: fe,
                    }),
                  }),
                ],
              }),
              e.jsxs("div", {
                className: "policy-hero-meta",
                children: [
                  e.jsxs("div", {
                    className: "policy-hero-meta-card",
                    children: [
                      e.jsx("div", {
                        className: "policy-hero-meta-label",
                        children: "Customer",
                      }),
                      e.jsx("div", {
                        className: "policy-hero-meta-value",
                        children: ne
                          ? e.jsx(se, {
                              to: `/customers/${encodeURIComponent(ne)}`,
                              children: Ke || ne,
                            })
                          : e.jsx("span", { children: xe || "-" }),
                      }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "policy-hero-meta-card",
                    children: [
                      e.jsx("div", {
                        className: "policy-hero-meta-label",
                        children: "Policy Premium",
                      }),
                      e.jsx("div", {
                        className: `policy-hero-meta-value ${Se(be) ? "amount-negative" : ""}`,
                        children: De(be) || "-",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
          e.jsx("div", {
            id: "policy-edit",
            className: "card policy-actions-card policy-section-card",
            children: e.jsxs("div", {
              className: "policy-actions-header",
              children: [
                e.jsx("h3", { children: "Policy Actions" }),
                e.jsxs("div", {
                  className: "policy-action-row",
                  children: [
                    e.jsx("button", {
                      type: "button",
                      className: "btn-secondary",
                      onClick: () => {
                        _("endorse");
                      },
                      disabled: (!R && !u.endorse) || o || M === "cancelled",
                      children: u.endorse ? "Continue Endorsement" : "Endorse",
                    }),
                    u.endorse &&
                      e.jsx("button", {
                        type: "button",
                        className: "btn-secondary",
                        onClick: () => K("endorse"),
                        disabled: o,
                        children: "Cancel Pending Endorsement",
                      }),
                    e.jsx("button", {
                      type: "button",
                      className: "btn-danger",
                      onClick: () => {
                        _("cancel");
                      },
                      disabled: (!R && !u.cancel) || o || M === "cancelled",
                      children: u.cancel ? "Continue Cancellation" : "Cancel",
                    }),
                    u.cancel &&
                      e.jsx("button", {
                        type: "button",
                        className: "btn-danger",
                        onClick: () => K("cancel"),
                        disabled: o,
                        children: "Cancel Pending Cancellation",
                      }),
                    e.jsx("button", {
                      type: "button",
                      className: "btn-secondary",
                      onClick: () => {
                        Le();
                      },
                      disabled: o || !he,
                      children: "Reinstate",
                    }),
                    e.jsx("button", {
                      type: "button",
                      className: "btn-secondary",
                      onClick: () => {
                        _("rewrite");
                      },
                      disabled: (!R && !u.rewrite) || o || !he,
                      children: u.rewrite ? "Continue Rewrite" : "Rewrite",
                    }),
                    u.rewrite &&
                      e.jsx("button", {
                        type: "button",
                        className: "btn-secondary",
                        onClick: () => K("rewrite"),
                        disabled: o,
                        children: "Cancel Pending Rewrite",
                      }),
                    e.jsx("button", {
                      type: "button",
                      className: "btn-secondary",
                      onClick: () => {
                        _("renew");
                      },
                      disabled: (!R && !u.renew) || o || M === "cancelled",
                      children: u.renew ? "Continue Renewal" : "Renew",
                    }),
                    u.renew &&
                      e.jsx("button", {
                        type: "button",
                        className: "btn-secondary",
                        onClick: () => K("renew"),
                        disabled: o,
                        children: "Cancel Pending Renewal",
                      }),
                    e.jsx("button", {
                      type: "button",
                      className: "btn-secondary",
                      onClick: () => w(!0),
                      disabled: o || M === "cancelled" || !!r.nonRenewedAt,
                      title: r.nonRenewedAt
                        ? "Non-renewal already issued"
                        : "Issue non-renewal notice",
                      children: "Non-Renew",
                    }),
                  ],
                }),
              ],
            }),
          }),
          e.jsx("div", {
            className: "card policy-summary-card policy-section-card",
            children: e.jsxs("div", {
              className: "policy-summary-grid",
              children: [
                e.jsxs("div", {
                  className: "policy-summary-item",
                  children: [
                    e.jsx("div", {
                      className: "policy-summary-label",
                      children: "Product",
                    }),
                    e.jsx("div", {
                      className: "policy-summary-value",
                      children: r.productCode,
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className: "policy-summary-item",
                  children: [
                    e.jsx("div", {
                      className: "policy-summary-label",
                      children: "Term",
                    }),
                    e.jsx("div", {
                      className: "policy-summary-value",
                      children: Be,
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className: "policy-summary-item",
                  children: [
                    e.jsx("div", {
                      className: "policy-summary-label",
                      children: "Policy Effective Date",
                    }),
                    e.jsx("div", {
                      className: "policy-summary-value",
                      children: T(r.term.effectiveDate),
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className: "policy-summary-item",
                  children: [
                    e.jsx("div", {
                      className: "policy-summary-label",
                      children: "Policy Expiration Date",
                    }),
                    e.jsx("div", {
                      className: "policy-summary-value",
                      children: T(r.term.expirationDate),
                    }),
                  ],
                }),
              ],
            }),
          }),
          ee === "Bound" &&
            e.jsx("div", {
              className: "card policy-bound-alert",
              children: e.jsxs("div", {
                className: "policy-bound-alert-row",
                children: [
                  e.jsxs("div", {
                    children: [
                      e.jsx("strong", {
                        children: "Policy is bound but not issued.",
                      }),
                      e.jsx("div", {
                        className: "muted",
                        children:
                          "Review/edit details below, then issue to lock the policy.",
                      }),
                    ],
                  }),
                  e.jsx("button", {
                    onClick: ze,
                    disabled: ye,
                    children: ye ? "Issuing..." : "Issue Policy",
                  }),
                ],
              }),
            }),
          e.jsxs("div", {
            className: "card policy-section-card policy-versions-card",
            children: [
              e.jsxs("table", {
                className: "table table-sticky-header",
                children: [
                  e.jsx("thead", {
                    children: e.jsxs("tr", {
                      children: [
                        e.jsx("th", {
                          "data-mobile-label": "Transaction #",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("transactionNumber"),
                            children: E("transactionNumber", "Transaction #"),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Effective Date",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("policyEffectiveDate"),
                            children: E(
                              "policyEffectiveDate",
                              "Effective Date",
                            ),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Transaction Effective Date",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("effectiveDate"),
                            children: e.jsxs(e.Fragment, {
                              children: [
                                "Transaction",
                                e.jsx("br", {}),
                                `Effective Date${Y("effectiveDate") ? ` ${Y("effectiveDate")}` : ""}`,
                              ],
                            }),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Expiration",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("expirationDate"),
                            children: E("expirationDate", "Expiration"),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Created Date",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("createdDate"),
                            children: E("createdDate", "Created Date"),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Updated Date",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("updatedDate"),
                            children: E("updatedDate", "Updated Date"),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Updated User",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("updatedUser"),
                            children: e.jsxs(e.Fragment, {
                              children: [
                                "Updated",
                                e.jsx("br", {}),
                                `User${Y("updatedUser") ? ` ${Y("updatedUser")}` : ""}`,
                              ],
                            }),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Type",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("transactionType"),
                            children: E("transactionType", "Type"),
                          }),
                        }),
                        e.jsx("th", {
                          "data-mobile-label": "Amount",
                          children: e.jsx("button", {
                            type: "button",
                            className: "table-sort-button",
                            onClick: () => P("amount"),
                            children: E("amount", "Amount"),
                          }),
                        }),
                      ],
                    }),
                  }),
                  e.jsxs("tbody", {
                    children: [
                      W.length === 0 &&
                        e.jsx("tr", {
                          children: e.jsx("td", {
                            colSpan: 9,
                            className: "muted",
                            children: "No versions",
                          }),
                        }),
                      $.rows.map((s) =>
                        e.jsxs(
                          "tr",
                          {
                            children: [
                              e.jsx("td", {
                                className: "muted",
                                children: e.jsx("button", {
                                  type: "button",
                                  className: "table-link-button id-mono",
                                  onClick: () => qe(s),
                                  children: s.transactionNumber || "Open",
                                }),
                              }),
                              e.jsx("td", {
                                children: T(
                                  s.policyEffectiveDate ||
                                    r.term?.effectiveDate,
                                ),
                              }),
                              e.jsx("td", { children: T(s.effectiveDate) }),
                              e.jsx("td", {
                                children: T(
                                  s.expirationDate || r.term?.expirationDate,
                                ),
                              }),
                              e.jsx("td", {
                                children: ve(s.createdDate || s.processedDate),
                              }),
                              e.jsx("td", {
                                children: ve(s.updatedDate || s.processedDate),
                              }),
                              e.jsx("td", {
                                children: s.updatedUser || "system",
                              }),
                              e.jsx("td", { children: s.transactionType }),
                              e.jsx("td", {
                                className: Se(s.premium?.total)
                                  ? "amount-negative"
                                  : void 0,
                                children: De(s.premium?.total),
                              }),
                            ],
                          },
                          s.versionId,
                        ),
                      ),
                    ],
                  }),
                ],
              }),
              W.length > 0 &&
                e.jsx(Ce, {
                  page: $.page,
                  pageSize: $.pageSize,
                  totalItems: $.totalItems,
                  onPageChange: $.setPage,
                  onPageSizeChange: $.setPageSize,
                }),
            ],
          }),
          (X || B) &&
            e.jsx("div", {
              className: "card stack-card policy-section-card policy-ai-card",
              children: e.jsxs("details", {
                className: "policy-collapsible",
                open: !!B,
                children: [
                  e.jsx("summary", {
                    className: "policy-collapsible-summary",
                    children: "AI / ML Insights",
                  }),
                  e.jsxs("div", {
                    className: "policy-collapsible-body",
                    children: [
                      B && e.jsx("div", { className: "error", children: B }),
                      X && e.jsx(Nt, { insights: X }),
                    ],
                  }),
                ],
              }),
            }),
          Ee &&
            e.jsx("div", {
              className: "card stack-card policy-section-card",
              children: "Loading history...",
            }),
          pe &&
            e.jsx("div", {
              className: "card stack-card policy-section-card",
              children: e.jsx("p", { className: "error", children: pe }),
            }),
          me && e.jsx(ht, { timeline: me }),
        ],
      }),
      p &&
        e.jsx(Dt, { policy: r, busy: A, onClose: () => w(!1), onSubmit: Ve }),
    ],
  });
}
function ht({ timeline: n }) {
  const t = Array.isArray(n?.ledger) ? n.ledger : [],
    a = we(t, 10);
  return e.jsx("div", {
    className: "card stack-card timeline-card",
    children: e.jsxs("details", {
      className: "timeline-ledger-collapsible",
      children: [
        e.jsxs("summary", {
          className: "timeline-ledger-toggle",
          children: ["History (", t.length, ")"],
        }),
        t.length === 0
          ? e.jsx("div", {
              className: "muted",
              children: "No history recorded.",
            })
          : e.jsxs(e.Fragment, {
              children: [
                e.jsxs("table", {
                  className: "table timeline-ledger-table",
                  children: [
                    e.jsx("thead", {
                      children: e.jsxs("tr", {
                        children: [
                          e.jsx("th", {
                            "data-mobile-label": "Event",
                            children: "Event",
                          }),
                          e.jsx("th", {
                            "data-mobile-label": "State",
                            children: "State",
                          }),
                          e.jsx("th", {
                            "data-mobile-label": "Occurred",
                            children: "Occurred",
                          }),
                          e.jsx("th", {
                            "data-mobile-label": "Actor",
                            children: "Actor",
                          }),
                        ],
                      }),
                    }),
                    e.jsx("tbody", {
                      children: a.rows.map((i) =>
                        e.jsxs(
                          "tr",
                          {
                            children: [
                              e.jsxs("td", {
                                children: [
                                  ft(i.event),
                                  e.jsx("div", {
                                    className: "muted timeline-ledger-summary",
                                    children: bt(i),
                                  }),
                                ],
                              }),
                              e.jsx("td", {
                                children:
                                  [i.fromState, i.toState]
                                    .filter(Boolean)
                                    .join(" -> ") || "-",
                              }),
                              e.jsx("td", {
                                children: Ie(i.occurredAt) || "-",
                              }),
                              e.jsx("td", { children: i.actor || "-" }),
                            ],
                          },
                          i.eventId,
                        ),
                      ),
                    }),
                  ],
                }),
                e.jsx(Ce, {
                  page: a.page,
                  pageSize: a.pageSize,
                  totalItems: a.totalItems,
                  onPageChange: a.setPage,
                  onPageSizeChange: a.setPageSize,
                }),
              ],
            }),
      ],
    }),
  });
}
function ft(n) {
  const t = String(n || "").trim();
  if (!t) return "-";
  const a = t.toUpperCase(),
    i = {
      STATUS_CHANGE: "Status Change",
      ENDORSE_ISSUED: "Endorsement Issued",
      CANCELLED: "Cancellation Issued",
      REINSTATED: "Reinstated",
      REWRITTEN: "Rewritten",
      RENEWED: "Renewed",
    };
  return i[a]
    ? i[a]
    : t
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b[a-z]/g, (l) => l.toUpperCase());
}
function bt(n) {
  const t = n?.payload;
  if (!t || typeof t != "object") return "Recorded by system";
  const a = [],
    i = String(t.transactionNumber || "").trim();
  i && a.push(`Transaction # ${i}`);
  const l = Number(t.delta);
  Number.isFinite(l) &&
    (l > 0
      ? a.push(`Additional premium ${ie(l)}`)
      : l < 0
        ? a.push(`Return premium ${ie(Math.abs(l))}`)
        : a.push("No premium change"));
  const o = Number(t.refund);
  if (
    (Number.isFinite(o) && a.push(`Refund ${ie(o)}`),
    Array.isArray(t.changes) && t.changes.length > 0)
  ) {
    const c = t.changes
        .map((N) => xt(N))
        .filter(Boolean)
        .slice(0, 2),
      x = t.changes.length > 2 ? ` +${t.changes.length - 2} more` : "";
    c.length
      ? a.push(`Updated ${c.join(", ")}${x}`)
      : a.push(`${t.changes.length} fields updated`);
  }
  const d = String(t.reason || "").trim();
  return (
    d && a.push(`Reason: ${d}`),
    t.effectiveDate && a.push(`Effective ${T(t.effectiveDate)}`),
    t.nextEffective && a.push(`Next term starts ${T(t.nextEffective)}`),
    t.issuedAt && a.push(`Issued ${Ie(t.issuedAt)}`),
    t.quoteId && a.push("Converted from quote"),
    a.length ? a.join(" | ") : "Recorded by system"
  );
}
function xt(n) {
  const t = String(n || "");
  return t
    ? t.startsWith("/coverages")
      ? "coverages"
      : t.startsWith("/risks")
        ? "risk details"
        : t.startsWith("/uwAnswers")
          ? "underwriting answers"
          : t.startsWith("/applicant")
            ? "applicant details"
            : t
                .replace(/^\//, "")
                .replace(/\//g, " ")
                .replace(/\b\d+\b/g, "")
                .replace(/\s+/g, " ")
                .trim() || ""
    : "";
}
function T(n) {
  return tt(n, { fallback: "" });
}
function ie(n, t = "USD") {
  const a = Number(n);
  return Number.isFinite(a)
    ? new Intl.NumberFormat(void 0, { style: "currency", currency: t }).format(
        a,
      )
    : String(n || "");
}
function Nt({ insights: n }) {
  const t = n?.scores || {},
    a = n?.summary || {},
    i = Array.isArray(n?.alerts) ? n.alerts : [],
    l = Array.isArray(n?.recommendations) ? n.recommendations : [],
    o = Array.isArray(n?.premiumTimeline) ? n.premiumTimeline : [];
  return e.jsxs(e.Fragment, {
    children: [
      e.jsxs("div", {
        className: "row",
        children: [
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "Policy Health Score" }),
              e.jsx("div", {
                children: Math.round(Number(n?.policyHealthScore || 0)),
              }),
            ],
          }),
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "Retention Risk" }),
              e.jsx("div", { children: ce(t.retentionRisk) }),
            ],
          }),
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "Premium Adequacy" }),
              e.jsx("div", { children: ce(t.premiumAdequacy) }),
            ],
          }),
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "Endorsement Complexity" }),
              e.jsx("div", { children: ce(t.endorsementComplexity) }),
            ],
          }),
        ],
      }),
      e.jsxs("div", {
        className: "row row-spaced",
        children: [
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "Current Policy Premium" }),
              e.jsx("div", {
                className:
                  Number(a.currentPolicyPremium) < 0
                    ? "amount-negative"
                    : void 0,
                children: L(a.currentPolicyPremium),
              }),
            ],
          }),
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "NB Premium" }),
              e.jsx("div", { children: L(a.nbPremium) }),
            ],
          }),
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "Net Change" }),
              e.jsx("div", {
                className:
                  Number(a.netChangeAmount) < 0 ? "amount-negative" : void 0,
                children: L(a.netChangeAmount),
              }),
            ],
          }),
          e.jsxs("div", {
            className: "col",
            children: [
              e.jsx("label", { children: "Out-of-Sequence" }),
              e.jsx("div", {
                children: Number(a.outOfSequenceTransactions || 0),
              }),
            ],
          }),
        ],
      }),
      i.length > 0 &&
        e.jsxs("div", {
          style: { marginTop: 10 },
          children: [
            e.jsx("div", { className: "muted", children: "Alerts" }),
            e.jsx("ul", {
              className: "dashboard-ai-list",
              children: i.map((d, c) => e.jsx("li", { children: d }, c)),
            }),
          ],
        }),
      l.length > 0 &&
        e.jsxs("div", {
          style: { marginTop: 8 },
          children: [
            e.jsx("div", { className: "muted", children: "Recommendations" }),
            e.jsx("ul", {
              className: "dashboard-ai-list",
              children: l.map((d, c) => e.jsx("li", { children: d }, c)),
            }),
          ],
        }),
      o.length > 0 &&
        e.jsxs("div", {
          style: { marginTop: 8 },
          children: [
            e.jsx("div", {
              className: "muted",
              children: "Premium Trajectory",
            }),
            e.jsxs("table", {
              className: "table",
              children: [
                e.jsx("thead", {
                  children: e.jsxs("tr", {
                    children: [
                      e.jsx("th", { children: "Transaction #" }),
                      e.jsx("th", { children: "Type" }),
                      e.jsx("th", { children: "Transaction Effective Date" }),
                      e.jsx("th", { children: "Amount" }),
                      e.jsx("th", { children: "Cumulative Policy Premium" }),
                    ],
                  }),
                }),
                e.jsx("tbody", {
                  children: o
                    .slice(-6)
                    .reverse()
                    .map((d, c) =>
                      e.jsxs(
                        "tr",
                        {
                          children: [
                            e.jsx("td", {
                              children: d.transactionNumber || "-",
                            }),
                            e.jsx("td", { children: d.transactionType || "-" }),
                            e.jsx("td", { children: T(d.effectiveDate) }),
                            e.jsx("td", {
                              className:
                                Number(d.amount) < 0
                                  ? "amount-negative"
                                  : void 0,
                              children: L(d.amount),
                            }),
                            e.jsx("td", {
                              className:
                                Number(d.cumulativePolicyPremium) < 0
                                  ? "amount-negative"
                                  : void 0,
                              children: L(d.cumulativePolicyPremium),
                            }),
                          ],
                        },
                        `${d.transactionNumber || d.transactionType || "tx"}-${c}`,
                      ),
                    ),
                }),
              ],
            }),
          ],
        }),
    ],
  });
}
function Ie(n) {
  return nt(n, { fallback: "" });
}
function ve(n, t = "-") {
  const a = String(n || "").trim();
  if (!a) return t;
  const i = new Date(a);
  if (Number.isNaN(i.getTime())) return t;
  const l = String(i.getMonth() + 1).padStart(2, "0"),
    o = String(i.getDate()).padStart(2, "0"),
    d = String(i.getFullYear()),
    c = String(i.getHours()).padStart(2, "0"),
    x = String(i.getMinutes()).padStart(2, "0");
  return `${l}-${o}-${d} ${c}:${x}`;
}
function gt(n) {
  return !Array.isArray(n) || n.length === 0
    ? 1
    : 1 +
        n.reduce((a, i) => {
          const l = String(i?.transactionType || "")
            .trim()
            .toUpperCase();
          return l === "RENEW" || l === "RENEWAL" ? a + 1 : a;
        }, 0);
}
function De(n) {
  if (!n) return "";
  const t = typeof n.amount == "number" ? n.amount : Number(n.amount),
    a = n.currency || "USD";
  return isFinite(t)
    ? new Intl.NumberFormat(void 0, { style: "currency", currency: a }).format(
        t,
      )
    : "";
}
function Se(n) {
  if (!n) return !1;
  const t = typeof n.amount == "number" ? n.amount : Number(n.amount);
  return Number.isFinite(t) && t < 0;
}
function ce(n) {
  const t = Number(n);
  return Number.isFinite(t) ? `${Math.round(t * 100)}%` : "-";
}
function L(n, t = "USD") {
  const a = Number(n);
  return Number.isFinite(a)
    ? new Intl.NumberFormat(void 0, { style: "currency", currency: t }).format(
        a,
      )
    : "-";
}
function jt(n) {
  if (!Array.isArray(n) || n.length === 0) return Array.isArray(n) ? n : [];
  const a = [...n.map((o, d) => ({ version: o, index: d }))].sort((o, d) => {
      const c = o.version,
        x = d.version,
        N = Date.parse(
          String(c?.processedDate || c?.updatedDate || c?.createdDate || ""),
        ),
        S = Date.parse(
          String(x?.processedDate || x?.updatedDate || x?.createdDate || ""),
        ),
        u = Number.isFinite(N) ? N : 0,
        m = Number.isFinite(S) ? S : 0;
      if (u !== m) return u - m;
      const p = Date.parse(String(c?.effectiveDate || "")),
        w = Date.parse(String(x?.effectiveDate || "")),
        A = Number.isFinite(p) ? p : 0,
        I = Number.isFinite(w) ? w : 0;
      return A !== I
        ? A - I
        : String(c?.transactionNumber || "").localeCompare(
            String(x?.transactionNumber || ""),
          );
    }),
    i = new Map();
  let l = 0;
  for (const o of a) {
    const d = o.version?.premium?.total,
      c = typeof d?.amount == "number" ? d.amount : Number(d?.amount);
    if (Number.isFinite(c)) {
      if (oe(o.version?.transactionType) && c < 0) {
        l = Math.abs(c);
        continue;
      }
      if (Pe(o.version?.transactionType)) {
        (Math.abs(c) < 0.01 && l > 0 && i.set(o.index, l), (l = 0));
        continue;
      }
      l = 0;
    }
  }
  return i.size === 0
    ? n
    : n.map((o, d) => {
        if (!i.has(d)) return o;
        const c = i.get(d),
          x = o?.premium && typeof o.premium == "object" ? o.premium : {},
          N = x?.total && typeof x.total == "object" ? x.total : {};
        return {
          ...o,
          premium: {
            ...x,
            total: {
              ...N,
              amount: c,
              currency:
                typeof N.currency == "string" && N.currency.trim()
                  ? N.currency
                  : "USD",
            },
          },
        };
      });
}
function vt(n, t) {
  if (!Array.isArray(n) || n.length === 0) return null;
  const a = G(t?.effectiveDate),
    i = G(t?.expirationDate),
    l = n.filter((u) => {
      if (!a && !i) return !0;
      const m = G(u?.policyEffectiveDate),
        p = G(u?.expirationDate);
      return !((a && m && m !== a) || (i && p && p !== i));
    }),
    d = [...(l.length > 0 ? l : n)].sort((u, m) => {
      const p = Date.parse(
          String(u?.processedDate || u?.updatedDate || u?.createdDate || ""),
        ),
        w = Date.parse(
          String(m?.processedDate || m?.updatedDate || m?.createdDate || ""),
        ),
        A = Number.isFinite(p) ? p : 0,
        I = Number.isFinite(w) ? w : 0;
      if (A !== I) return A - I;
      const r = Date.parse(String(u?.effectiveDate || "")),
        V = Date.parse(String(m?.effectiveDate || "")),
        q = Number.isFinite(r) ? r : 0,
        O = Number.isFinite(V) ? V : 0;
      return q !== O
        ? q - O
        : String(u?.transactionNumber || "").localeCompare(
            String(m?.transactionNumber || ""),
          );
    });
  let c = 0,
    x = !1,
    N = "USD",
    S = 0;
  for (const u of d) {
    const m = u?.premium?.total,
      p = typeof m?.amount == "number" ? m.amount : Number(m?.amount);
    if (!Number.isFinite(p)) continue;
    let w = p;
    (oe(u?.transactionType) && p < 0
      ? (S = Math.abs(p))
      : Pe(u?.transactionType) &&
        (Math.abs(p) < 0.01 && S > 0 && (w = S), (S = 0)),
      (x = !0),
      (c += w),
      typeof m?.currency == "string" &&
        m.currency.trim() &&
        (N = m.currency.trim()));
  }
  return x ? { amount: c, currency: N } : null;
}
function G(n) {
  const t = String(n || "").trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const a = new Date(t);
  if (Number.isNaN(a.getTime())) return "";
  const i = String(a.getFullYear()),
    l = String(a.getMonth() + 1).padStart(2, "0"),
    o = String(a.getDate()).padStart(2, "0");
  return `${i}-${l}-${o}`;
}
function Dt({ policy: n, busy: t, onClose: a, onSubmit: i }) {
  const l = new Date().toISOString().slice(0, 10),
    [o, d] = v.useState(l),
    [c, x] = v.useState(""),
    [N, S] = v.useState(""),
    u = (p) => {
      (p.preventDefault(), i(o, c, N));
    },
    m = n.term?.expirationDate
      ? new Date(n.term.expirationDate).toLocaleDateString()
      : "term end";
  return e.jsx("div", {
    className: "modal-overlay",
    role: "dialog",
    "aria-modal": "true",
    children: e.jsxs("div", {
      className: "modal-panel",
      children: [
        e.jsxs("div", {
          className: "modal-header",
          children: [
            e.jsxs("h3", { children: ["Non-Renew Policy ", n.policyNumber] }),
            e.jsx("button", {
              type: "button",
              className: "btn-secondary",
              onClick: a,
              children: "Close",
            }),
          ],
        }),
        e.jsxs("form", {
          onSubmit: u,
          children: [
            e.jsxs("div", {
              className: "muted",
              style: { marginBottom: 12 },
              children: [
                "This policy will not be renewed at expiration (",
                m,
                "). It remains active until then.",
              ],
            }),
            e.jsxs("div", {
              className: "row",
              children: [
                e.jsxs("div", {
                  className: "col",
                  children: [
                    e.jsx("label", { children: "Notice Date *" }),
                    e.jsx("input", {
                      type: "date",
                      value: o,
                      onChange: (p) => d(p.target.value),
                      required: !0,
                    }),
                    e.jsx("div", {
                      className: "muted",
                      style: { fontSize: "0.85em" },
                      children: "Date notice is sent to insured",
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className: "col",
                  children: [
                    e.jsx("label", { children: "Reason Code" }),
                    e.jsxs("select", {
                      value: c,
                      onChange: (p) => x(p.target.value),
                      children: [
                        e.jsx("option", { value: "", children: "- Select -" }),
                        e.jsx("option", {
                          value: "UW_CHANGE",
                          children: "Underwriting Change",
                        }),
                        e.jsx("option", {
                          value: "CAPACITY",
                          children: "Capacity / Market Exit",
                        }),
                        e.jsx("option", {
                          value: "LOSS_HISTORY",
                          children: "Adverse Loss History",
                        }),
                        e.jsx("option", {
                          value: "RISK_CHANGE",
                          children: "Unacceptable Change in Risk",
                        }),
                        e.jsx("option", { value: "OTHER", children: "Other" }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
            e.jsxs("div", {
              style: { marginTop: 10 },
              children: [
                e.jsx("label", { children: "Reason / Notes" }),
                e.jsx("textarea", {
                  value: N,
                  onChange: (p) => S(p.target.value),
                  rows: 3,
                  placeholder: "Reason for non-renewal",
                  style: { width: "100%" },
                }),
              ],
            }),
            e.jsxs("div", {
              style: {
                marginTop: 12,
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              },
              children: [
                e.jsx("button", {
                  type: "button",
                  className: "btn-secondary",
                  onClick: a,
                  disabled: t,
                  children: "Close",
                }),
                e.jsx("button", {
                  type: "submit",
                  disabled: t,
                  children: t ? "Processing..." : "Issue Non-Renewal Notice",
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  });
}
export { Tt as PolicyViewPage };
