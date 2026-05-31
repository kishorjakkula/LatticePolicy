import React, {
  FormEvent,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, adminApi } from "../../api/client";
import { formatDisplayDateTime } from "../../shared/dateDisplay";
import { hasPermission } from "../../auth/permissions";
import { useAuth } from "../../auth/AuthContext";
import {
  useCopyQuoteMutation,
  useCreateCustomerMutation,
} from "../../api/hooks";
import { StatusBadge } from "../../components/StatusBadge";
import { Checkbox } from "../../components/Checkbox";
import { Pagination } from "../../components/Pagination";
import { LoadingBar } from "../../components/LoadingBar";
import { ActionButton } from "../../components/ActionButton";
import { PolicyRow } from "./PolicyRow";

// Lazy-loaded: only fetched when the context menu is first opened
const PolicyContextMenuLazy = lazy(() =>
  import("./PolicyContextMenu").then((m) => ({ default: m.PolicyContextMenu })),
);

type PolicySortField =
  | "policyNumber"
  | "insuredName"
  | "productCode"
  | "state"
  | "effectiveDate"
  | "premium"
  | "agentName"
  | "status"
  // Legacy URL-compat values â€” no longer shown as headers
  | "createdAt"
  | "updatedAt"
  | "updatedBy";

/** Fields the server supports natively; others fall back to client-side sort */
const SERVER_SORT_FIELDS = new Set<string>([
  "policyNumber",
  "productCode",
  "effectiveDate",
  "status",
  "createdAt",
  "updatedAt",
  "updatedBy",
]);

function normalizePolicyStatusFilterValue(value: string): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "bound") return "Bind";
  if (normalized === "inforce") return "Inforced";
  if (normalized === "canceled") return "Cancelled";
  return value;
}

function isPolicySortField(value: string): value is PolicySortField {
  return [
    "policyNumber",
    "insuredName",
    "productCode",
    "state",
    "effectiveDate",
    "premium",
    "agentName",
    "status",
    "createdAt",
    "updatedAt",
    "updatedBy",
  ].includes(value);
}

function defaultSortDirForField(field: PolicySortField): "asc" | "desc" {
  if (
    field === "effectiveDate" ||
    field === "createdAt" ||
    field === "updatedAt" ||
    field === "premium"
  )
    return "desc";
  return "asc";
}

export function SearchPage() {
  const { user } = useAuth();
  const canSearchCustomers = hasPermission(user, "admin.customers.read");
  const canManageCustomers = hasPermission(user, "admin.customers.manage");
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const initialQ = sp.get("q") || "";
  const initialProduct = sp.get("product") || "";
  const initialStatus = normalizePolicyStatusFilterValue(sp.get("status") || "");
  const initialPage = Math.max(1, Number(sp.get("page") || 1) || 1);
  const initialPageSize = Math.max(1, Number(sp.get("pageSize") || 20) || 20);
  const initialStateFilter = sp.get("state") || "";
  const initialDateFrom = sp.get("dateFrom") || "";
  const initialDateTo = sp.get("dateTo") || "";
  const [q, setQ] = useState(initialQ);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<string>(initialProduct);
  const [status, setStatus] = useState<string>(initialStatus);
  const [page, setPage] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [total, setTotal] = useState<number>(0);
  const [copyingQuoteId, setCopyingQuoteId] = useState<string | null>(null);
  const modeParam = sp.get("mode");
  const initialMode =
    modeParam === "quotes"
      ? "quotes"
      : modeParam === "customers" && canSearchCustomers
        ? "customers"
        : "policies";
  const initialSortBy = isPolicySortField((sp.get("sortBy") || "").trim())
    ? (sp.get("sortBy") as PolicySortField)
    : "effectiveDate";
  const initialSortDir =
    (sp.get("sortDir") || "").toLowerCase() === "asc" ? "asc" : "desc";
  const [mode, setMode] = useState<"policies" | "quotes" | "customers">(
    initialMode,
  );
  const [policySortBy, setPolicySortBy] =
    useState<PolicySortField>(initialSortBy);
  const [policySortDir, setPolicySortDir] = useState<"asc" | "desc">(
    initialSortDir,
  );
  const typingTimer = useRef<any>(null);
  const skipNextAutoSearchRef = useRef(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const copyQuoteMutation = useCopyQuoteMutation();
  const createCustomerMutation = useCreateCustomerMutation();
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [addCustomerError, setAddCustomerError] = useState<string | null>(null);
  const [addCustomerForm, setAddCustomerForm] = useState({
    entityType: "INDIVIDUAL" as "INDIVIDUAL" | "COMPANY" | "BOTH",
    status: "DRAFT",
    firstName: "",
    lastName: "",
    dob: "",
    legalName: "",
    incorporationState: "",
    email: "",
    phone: "",
  });

  const [state, setState] = useState<string>(initialStateFilter);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    policy: any;
  } | null>(null);

  // Initialize from URL and react to external URL param updates (e.g., global top search)
  useEffect(() => {
    const nextQ = sp.get("q") || "";
    const nextProduct = sp.get("product") || "";
    const nextStatus = normalizePolicyStatusFilterValue(sp.get("status") || "");
    const nextPage = Number(sp.get("page") || 1);
    const nextPageSize = Number(sp.get("pageSize") || 20);
    const nextState = sp.get("state") || "";
    const nextDateFrom = sp.get("dateFrom") || "";
    const nextDateTo = sp.get("dateTo") || "";
    let changed = false;
    if (q !== nextQ) {
      changed = true;
      setQ(nextQ);
    }
    if (product !== nextProduct) {
      changed = true;
      setProduct(nextProduct);
    }
    if (status !== nextStatus) {
      changed = true;
      setStatus(nextStatus);
    }
    if (page !== nextPage) {
      changed = true;
      setPage(nextPage);
    }
    if (pageSize !== nextPageSize) {
      changed = true;
      setPageSize(nextPageSize);
    }
    if (state !== nextState) {
      changed = true;
      setState(nextState);
    }
    if (dateFrom !== nextDateFrom) {
      changed = true;
      setDateFrom(nextDateFrom);
    }
    if (dateTo !== nextDateTo) {
      changed = true;
      setDateTo(nextDateTo);
    }
    const nextMode = sp.get("mode");
    const resolvedMode =
      nextMode === "quotes"
        ? "quotes"
        : nextMode === "customers" && canSearchCustomers
          ? "customers"
          : "policies";
    if (mode !== resolvedMode) {
      changed = true;
      setMode(resolvedMode);
    }
    const nextSortBy = (sp.get("sortBy") || "").trim();
    if (isPolicySortField(nextSortBy)) {
      if (policySortBy !== nextSortBy) {
        changed = true;
        setPolicySortBy(nextSortBy);
      }
    }
    const nextSortDir =
      (sp.get("sortDir") || "").toLowerCase() === "asc" ? "asc" : "desc";
    if (policySortDir !== nextSortDir) {
      changed = true;
      setPolicySortDir(nextSortDir);
    }
    if (changed) {
      skipNextAutoSearchRef.current = true;
    }
  }, [sp, canSearchCustomers]);

  const loadPolicies = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.searchPolicies(q, {
        product,
        status,
        page,
        pageSize,
        sortBy: policySortBy,
        sortDir: policySortDir,
        effectiveFrom: dateFrom || undefined,
        effectiveTo: dateTo || undefined,
      });
      const items = resp?.items ?? resp ?? [];
      setResults(items);
      setTotal(resp?.total ?? items.length);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadQuotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.searchQuotes(q, {
        product,
        status,
        page,
        pageSize,
        sortBy: "effectiveDate",
        sortDir: "desc",
      });
      const items = resp?.items ?? resp ?? [];
      setResults(items);
      setTotal(resp?.total ?? items.length);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await adminApi.searchCustomers({
        q,
        status: status || undefined,
        limit: 500,
      });
      setResults(Array.isArray(items) ? items : []);
      setTotal(Array.isArray(items) ? items.length : 0);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const runActiveSearch = () => {
    if (mode === "policies") {
      void loadPolicies();
    } else if (mode === "quotes") {
      void loadQuotes();
    } else if (canSearchCustomers) {
      void loadCustomers();
    } else {
      setResults([]);
      setTotal(0);
      setLoading(false);
      setError(null);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    runActiveSearch();
  };

  const copyQuote = async (quoteId: string) => {
    if (!quoteId) return;
    setCopyingQuoteId(quoteId);
    setError(null);
    try {
      const resp = await copyQuoteMutation.mutateAsync(quoteId);
      navigate(`/wizard?quoteId=${resp.quoteId}`);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setCopyingQuoteId(null);
    }
  };

  const switchMode = (next: "policies" | "quotes" | "customers") => {
    if (mode === next) return;
    setMode(next);
    setQ("");
    setResults([]);
    setPage(1);
    setStatus("");
    if (next === "customers") {
      setProduct("");
    }
  };

  const openAddCustomerModal = () => {
    const tokens = String(q || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    setAddCustomerError(null);
    setAddCustomerForm({
      entityType: "INDIVIDUAL",
      status: "DRAFT",
      firstName: tokens[0] || "",
      lastName: tokens.length > 1 ? tokens.slice(1).join(" ") : "",
      dob: "",
      legalName: "",
      incorporationState: "",
      email: "",
      phone: "",
    });
    setShowAddCustomerModal(true);
  };

  const savingCustomer = createCustomerMutation.isPending;
  const saveQuickCustomer = async () => {
    if (!canManageCustomers || savingCustomer) return;
    const entityType = addCustomerForm.entityType;
    const firstName = String(addCustomerForm.firstName || "").trim();
    const lastName = String(addCustomerForm.lastName || "").trim();
    const dob = String(addCustomerForm.dob || "").trim();
    const legalName = String(addCustomerForm.legalName || "").trim();
    const incorporationState = String(addCustomerForm.incorporationState || "")
      .trim()
      .toUpperCase();
    const email = String(addCustomerForm.email || "").trim();
    const phone = String(addCustomerForm.phone || "").trim();
    if (
      (entityType === "INDIVIDUAL" || entityType === "BOTH") &&
      (!firstName || !lastName || !dob)
    ) {
      setAddCustomerError("First Name, Last Name, and DOB are required.");
      return;
    }
    if (
      (entityType === "COMPANY" || entityType === "BOTH") &&
      (!legalName || !incorporationState)
    ) {
      setAddCustomerError(
        "Legal Name and Incorporation State are required for company.",
      );
      return;
    }
    if (!email && !phone) {
      setAddCustomerError("Enter at least one contact: email or phone.");
      return;
    }
    setAddCustomerError(null);
    try {
      const payload: any = {
        entityType,
        status: addCustomerForm.status || "DRAFT",
        identity: {
          person: {
            firstName,
            lastName,
            dob,
          },
          company: {
            legalName,
            incorporationState,
          },
        },
        contactPoints: [
          ...(email
            ? [{ contactType: "EMAIL", value: email, preferred: !phone }]
            : []),
          ...(phone
            ? [{ contactType: "PHONE", value: phone, preferred: !email }]
            : []),
        ],
      };
      const created = await createCustomerMutation.mutateAsync(payload);
      const customerKey = String(created?.customerKey || "").trim();
      if (customerKey) setQ(customerKey);
      setPage(1);
      setMode("customers");
      await loadCustomers();
      setShowAddCustomerModal(false);
    } catch (err: any) {
      setAddCustomerError(err?.message || String(err));
    }
  };

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / pageSize)),
    [total, pageSize],
  );
  const canPrev = page > 1;
  const canNext = page < totalPages;

  // Keep URL in sync with filters and paging
  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    else params.delete("q");
    if (product) params.set("product", product);
    if (status) params.set("status", status);
    if (state) params.set("state", state);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    params.set("mode", mode);
    if (mode === "policies") {
      params.set("sortBy", policySortBy);
      params.set("sortDir", policySortDir);
    } else {
      params.delete("sortBy");
      params.delete("sortDir");
    }
    if (params.toString() !== sp.toString()) {
      setSp(params, { replace: true });
    }
  }, [
    q,
    product,
    status,
    state,
    dateFrom,
    dateTo,
    page,
    pageSize,
    mode,
    policySortBy,
    policySortDir,
    sp,
    setSp,
  ]);

  // Auto-run search on changes with a small debounce for text query
  useEffect(() => {
    if (skipNextAutoSearchRef.current) {
      skipNextAutoSearchRef.current = false;
      return;
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (!q.trim()) {
      runActiveSearch();
      return;
    }
    typingTimer.current = setTimeout(() => {
      runActiveSearch();
      typingTimer.current = null;
    }, 180);
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [
    mode,
    q,
    product,
    status,
    state,
    dateFrom,
    dateTo,
    page,
    pageSize,
    policySortBy,
    policySortDir,
    canSearchCustomers,
  ]);

  const togglePolicySort = (field: PolicySortField) => {
    setPage(1);
    if (policySortBy === field) {
      setPolicySortDir(policySortDir === "asc" ? "desc" : "asc");
      return;
    }
    setPolicySortBy(field);
    setPolicySortDir(defaultSortDirForField(field));
  };

  const pagedCustomerResults = useMemo(() => {
    if (mode !== "customers") return results;
    const start = (page - 1) * pageSize;
    return results.slice(start, start + pageSize);
  }, [mode, results, page, pageSize]);

  // Apply client-side sorting for fields not natively supported by the server
  const displayResults = useMemo(() => {
    let base = results;
    // Client-side state filter
    if (mode === "policies" && state) {
      base = base.filter(
        (p: any) => (p.state || p.term?.state || "") === state,
      );
    }
    if (mode !== "policies" || SERVER_SORT_FIELDS.has(policySortBy))
      return base;
    const dir = policySortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      switch (policySortBy) {
        case "insuredName": {
          const av = String(a.insuredName || a.customer?.name || "");
          const bv = String(b.insuredName || b.customer?.name || "");
          return av.localeCompare(bv) * dir;
        }
        case "state": {
          const av = String(a.state || a.term?.state || "");
          const bv = String(b.state || b.term?.state || "");
          return av.localeCompare(bv) * dir;
        }
        case "premium": {
          const av = Number(
            a.premium?.total?.amount ?? a.annualPremium ?? a.totalPremium ?? 0,
          );
          const bv = Number(
            b.premium?.total?.amount ?? b.annualPremium ?? b.totalPremium ?? 0,
          );
          return (av - bv) * dir;
        }
        case "agentName": {
          const av = String(
            a.agentName || a.agent?.name || a.agency?.name || "",
          );
          const bv = String(
            b.agentName || b.agent?.name || b.agency?.name || "",
          );
          return av.localeCompare(bv) * dir;
        }
        default:
          return 0;
      }
    });
  }, [results, mode, policySortBy, policySortDir, state]);

  // Row selection helpers â€” useCallback so PolicyRow.memo skips re-renders
  const handleToggleRow = useCallback((id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allRowsSelected =
    displayResults.length > 0 &&
    displayResults.every((p) => selectedRows.has(p.policyId));
  const someRowsSelected =
    !allRowsSelected &&
    displayResults.some((p) => selectedRows.has(p.policyId));

  const handleToggleAllRows = useCallback(
    (checked: boolean) => {
      setSelectedRows(
        checked ? new Set(displayResults.map((p) => p.policyId)) : new Set(),
      );
    },
    [displayResults],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, policy: any) => {
    e.preventDefault();
    const menuW = 230,
      menuH = 360;
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - menuW - 8),
      y: Math.min(e.clientY, window.innerHeight - menuH - 8),
      policy,
    });
  }, []);

  const handleNavigate = useCallback(
    (path: string) => navigate(path),
    [navigate],
  );

  const clearFilters = () => {
    setQ("");
    setProduct("");
    setStatus("");
    setState("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
    setPageSize(20);
    setPolicySortBy("effectiveDate");
    setPolicySortDir("desc");
  };

  const hasFilters = !!(q || product || status || state || dateFrom || dateTo);

  // Keyboard shortcuts: / â†’ focus search, N â†’ new quote
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputActive =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "/" && !isInputActive) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
      if (e.key === "n" && !isInputActive && !e.metaKey && !e.ctrlKey) {
        navigate("/wizard");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  // Sort header button â€” closes over sort state + handler
  const SortHeader = ({
    field,
    label,
  }: {
    field: PolicySortField;
    label: string;
  }) => (
    <button
      type="button"
      className="ps-sort-header"
      onClick={() => togglePolicySort(field)}
      aria-sort={
        policySortBy === field
          ? policySortDir === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <span className="ps-sort-label">{label}</span>
      {policySortBy === field ? (
        <span
          className="ps-sort-indicator ps-sort-indicator--active"
          aria-hidden="true"
        >
          {policySortDir === "asc" ? "^" : "v"}
        </span>
      ) : (
        <span className="ps-sort-indicator" aria-hidden="true">
          {"<>"}
        </span>
      )}
    </button>
  );

  return (
    <div className="ps-page-shell policy-search-shell">
      {/* Breadcrumbs */}
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">
          Home
        </Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span className="ps-breadcrumb-current">Policy Search</span>
      </nav>

      <div className="card page-shell policy-hero policy-search-hero">
        {/* Page title + primary action */}
        <div className="ps-page-header">
          <div className="policy-hero-main">
            <h1 className="ps-page-title">Policy Search</h1>
          </div>
          <div className="ps-page-header-actions">
            <ActionButton variant="success" onClick={() => navigate("/wizard")}>
              New Quote
            </ActionButton>
            {mode === "customers" &&
              canManageCustomers &&
              !loading &&
              results.length === 0 && (
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={openAddCustomerModal}
                >
                  Add Customer
                </ActionButton>
              )}
          </div>
        </div>

        {/* Tab row */}
        <div className="ps-tabs-row" role="tablist" aria-label="Search mode">
          {canSearchCustomers && (
            <button
              type="button"
              role="tab"
              aria-selected={mode === "customers"}
              className={`ps-tab${mode === "customers" ? " ps-tab--active" : ""}`}
              onClick={() => switchMode("customers")}
            >
              Customers
              {mode === "customers" && total > 0 && (
                <span className="ps-tab-badge">{total.toLocaleString()}</span>
              )}
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={mode === "policies"}
            className={`ps-tab${mode === "policies" ? " ps-tab--active" : ""}`}
            onClick={() => switchMode("policies")}
          >
            Policies
            {mode === "policies" && total > 0 && (
              <span className="ps-tab-badge">{total.toLocaleString()}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "quotes"}
            className={`ps-tab${mode === "quotes" ? " ps-tab--active" : ""}`}
            onClick={() => switchMode("quotes")}
          >
            Quotes
            {mode === "quotes" && total > 0 && (
              <span className="ps-tab-badge">{total.toLocaleString()}</span>
            )}
          </button>
        </div>
      </div>
      {/* Accessible live region â€” announces search result counts to screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {loading
          ? "Loading results..."
          : mode === "policies"
            ? total === 0
              ? "No policies found."
              : `${total} ${total === 1 ? "policy" : "policies"} found.`
            : mode === "quotes"
              ? total === 0
                ? "No quotes found."
                : `${total} ${total === 1 ? "quote" : "quotes"} found.`
              : total === 0
                ? "No customers found."
                : `${total} ${total === 1 ? "customer" : "customers"} found.`}
      </div>

      {/* ===== Filter Panel ===== */}
      <div className="ps-filter-panel policy-section-card">
        <form
          onSubmit={onSubmit}
          className="ps-filter-grid"
          role="search"
          aria-label="Search filters"
        >
          <div className="ps-filter-col ps-filter-col--wide">
            <label className="ps-filter-label" htmlFor="filter-query">
              Search
            </label>
            <div className="ps-filter-input-wrap">
              <input
                id="filter-query"
                ref={searchInputRef}
                className="ps-filter-input"
                placeholder={
                  mode === "policies"
                    ? "Policy # or Insured Name"
                    : mode === "quotes"
                      ? "Quote # or ID"
                      : "Customer key, name, phone, or email"
                }
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          {mode !== "customers" && (
            <div className="ps-filter-col">
              <label className="ps-filter-label" htmlFor="filter-product">
                Product
              </label>
              <select
                id="filter-product"
                className="ps-filter-select"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">All Products</option>
                <option value="personal-auto">Personal Auto</option>
                <option value="commercial-auto">Commercial Auto</option>
                <option value="homeowners">Homeowners</option>
                <option value="cyber">Cyber</option>
                <option value="professional-liability">
                  Professional Liability
                </option>
              </select>
            </div>
          )}
          <div className="ps-filter-col">
            <label className="ps-filter-label" htmlFor="filter-status">
              Status
            </label>
            <select
              id="filter-status"
              className="ps-filter-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              {mode === "policies" ? (
                <>
                  <option value="Draft">Draft</option>
                  <option value="Rated">Rated</option>
                  <option value="Bind">Bind</option>
                  <option value="Issued">Issued</option>
                  <option value="Inforced">In Force</option>
                  <option value="Expired">Expired</option>
                  <option value="Cancelled">Cancelled</option>
                </>
              ) : mode === "quotes" ? (
                <>
                  <option value="Draft">Draft</option>
                  <option value="Rated">Rated</option>
                </>
              ) : (
                <>
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="MERGED">Merged</option>
                  <option value="PENDING_APPROVAL">Pending Approval</option>
                  <option value="ARCHIVED">Archived</option>
                </>
              )}
            </select>
          </div>
          {mode === "policies" && (
            <div className="ps-filter-col">
              <label className="ps-filter-label" htmlFor="filter-state">
                State
              </label>
              <select
                id="filter-state"
                className="ps-filter-select"
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="">All States</option>
                {[
                  "AL",
                  "AK",
                  "AZ",
                  "AR",
                  "CA",
                  "CO",
                  "CT",
                  "DE",
                  "FL",
                  "GA",
                  "HI",
                  "ID",
                  "IL",
                  "IN",
                  "IA",
                  "KS",
                  "KY",
                  "LA",
                  "ME",
                  "MD",
                  "MA",
                  "MI",
                  "MN",
                  "MS",
                  "MO",
                  "MT",
                  "NE",
                  "NV",
                  "NH",
                  "NJ",
                  "NM",
                  "NY",
                  "NC",
                  "ND",
                  "OH",
                  "OK",
                  "OR",
                  "PA",
                  "RI",
                  "SC",
                  "SD",
                  "TN",
                  "TX",
                  "UT",
                  "VT",
                  "VA",
                  "WA",
                  "WV",
                  "WI",
                  "WY",
                ].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="ps-filter-actions">
            <button
              type="submit"
              className="ps-filter-btn-search"
              disabled={loading}
            >
              Search
            </button>
            {hasFilters && (
              <button
                type="button"
                className="ps-filter-btn-clear"
                onClick={clearFilters}
              >
                Clear
              </button>
            )}
          </div>
        </form>

        {/* Footer: advanced toggle + applied chip */}
        <div className="ps-filter-footer">
          <button
            type="button"
            className="ps-advanced-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? "v" : ">"} Advanced Filters
          </button>
          {hasFilters && (
            <span className="ps-filter-applied">
              {[
                q && "Search",
                product && "Product",
                status && "Status",
                state && "State",
                dateFrom && "Date",
              ]
                .filter(Boolean)
                .join(", ")}{" "}
              applied
            </span>
          )}
        </div>

        {/* Advanced filters */}
        {showAdvanced && (
          <div className="ps-advanced-filters">
            <div className="ps-filter-col">
              <label className="ps-filter-label" htmlFor="filter-date-from">
                Effective Date From
              </label>
              <input
                id="filter-date-from"
                type="date"
                className="ps-filter-date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="ps-filter-col">
              <label className="ps-filter-label" htmlFor="filter-date-to">
                Effective Date To
              </label>
              <input
                id="filter-date-to"
                type="date"
                className="ps-filter-date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="ps-filter-col">
              <label className="ps-filter-label" htmlFor="filter-agent">
                Agent / Producer
              </label>
              <select id="filter-agent" className="ps-filter-select">
                <option value="">All Agents</option>
              </select>
            </div>
            <div className="ps-filter-col">
              <label className="ps-filter-label" htmlFor="filter-lob">
                Line of Business
              </label>
              <select id="filter-lob" className="ps-filter-select">
                <option value="">All LOBs</option>
                <option value="auto">Auto</option>
                <option value="property">Property</option>
                <option value="liability">Liability</option>
                <option value="inland-marine">Inland Marine</option>
              </select>
            </div>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="results-wrap policy-search-results-wrap">
        <div className="policy-search-results-card">
          <div style={{ display: mode === "policies" ? "block" : "none" }}>
            {/* Results meta bar */}
            <div className="ps-table-meta">
              <span className="ps-table-count">
                {loading ? (
                  "Loading..."
                ) : total > 0 ? (
                  <>
                    {`Showing `}
                    <strong>
                      {(page - 1) * pageSize + 1}-
                      {Math.min(page * pageSize, total)}
                    </strong>
                    {` of `}
                    <strong>{total.toLocaleString()}</strong>
                    {` ${total === 1 ? "policy" : "policies"}`}
                  </>
                ) : (
                  "No policies found"
                )}
              </span>
              <div className="ps-table-meta-actions">
                <button type="button" className="ps-meta-btn">
                  Export CSV
                </button>
                <button type="button" className="ps-meta-btn">
                  Columns
                </button>
              </div>
            </div>

            {/* Bulk actions bar â€” slide in when rows selected */}
            {selectedRows.size > 0 && (
              <div className="ps-bulk-bar" role="status" aria-live="polite">
                <span className="ps-bulk-count">
                  {selectedRows.size}{" "}
                  {selectedRows.size === 1 ? "policy" : "policies"} selected
                </span>
                <div className="ps-bulk-actions">
                  <button type="button" className="ps-bulk-btn">
                    Export
                  </button>
                  <button type="button" className="ps-bulk-btn">
                    Generate Report
                  </button>
                  <button type="button" className="ps-bulk-btn">
                    Bulk Tag
                  </button>
                </div>
                <button
                  type="button"
                  className="ps-bulk-clear"
                  onClick={() => setSelectedRows(new Set())}
                >
                  Clear selection
                </button>
              </div>
            )}

            {/* Table card */}
            <div className="ps-table-card" ref={tableRef}>
              <LoadingBar active={loading} />
              <table className="table ps-policy-table" role="grid">
                <colgroup>
                  <col style={{ width: 36 }} />
                  <col style={{ width: 120 }} />
                  <col />
                  <col />
                  <col />
                <col style={{ width: 116 }} />
                <col style={{ width: 116 }} />
                <col />
                <col style={{ width: 110 }} />
              </colgroup>
                <thead>
                  <tr>
                    <th data-col="check" aria-label="Select all rows">
                      <Checkbox
                        checked={allRowsSelected}
                        indeterminate={someRowsSelected}
                        onChange={handleToggleAllRows}
                        ariaLabel="Select all rows on this page"
                      />
                    </th>
                    <th data-col="policy-num">
                      <SortHeader field="policyNumber" label="Policy #" />
                    </th>
                    <th data-col="insured">
                      <SortHeader field="insuredName" label="Insured Name" />
                    </th>
                    <th data-col="product">
                      <SortHeader field="productCode" label="Product" />
                    </th>
                    <th data-col="dates">
                      <SortHeader
                        field="effectiveDate"
                        label="Effective -> Expiry"
                      />
                    </th>
                    <th data-col="created">
                      <SortHeader field="createdAt" label="Created" />
                    </th>
                    <th data-col="updated">
                      <SortHeader field="updatedAt" label="Updated" />
                    </th>
                    <th data-col="premium">
                      <SortHeader field="premium" label="Premium" />
                    </th>
                  <th data-col="status">
                    <SortHeader field="status" label="Status" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayResults.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="ps-empty-cell">
                        <div className="ps-empty-state">
                          <div className="ps-empty-icon" aria-hidden="true">
                            ðŸ”
                          </div>
                          <h3 className="ps-empty-title">No policies found</h3>
                          <p className="ps-empty-desc">
                            Try adjusting your search filters
                          </p>
                          {(q || product || status) && (
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={clearFilters}
                            >
                              Clear all filters
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    displayResults.map((p: any) => (
                      <PolicyRow
                        key={p.policyId}
                        policy={p}
                        isSelected={selectedRows.has(p.policyId)}
                        onToggle={handleToggleRow}
                        onContextMenu={handleContextMenu}
                        onNavigate={handleNavigate}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {mode === "quotes" && (
            <table className="table table-sticky-header policy-search-table">
              <thead>
                <tr>
                  <th data-mobile-label="Quote #">Quote #</th>
                  <th data-mobile-label="Product">Product</th>
                  <th data-mobile-label="Status">Status</th>
                  <th data-mobile-label="Progress">Progress</th>
                  <th data-mobile-label="Updated">Updated</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      No results
                    </td>
                  </tr>
                ) : (
                  results.map((item: any) => (
                    <tr key={item.quoteId}>
                      <td>
                        <Link
                          to={`/wizard?quoteId=${item.quoteId}`}
                          className="table-link-button id-mono"
                        >
                          {item.quoteNumber || item.quoteId}
                        </Link>
                      </td>
                      <td>{item.productCode}</td>
                      <td>{item.status}</td>
                      <td>{item.progressStep ?? ""}</td>
                      <td>
                        {formatDisplayDateTime(item.updatedAt, {
                          fallback: "",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
          {mode === "customers" && (
            <table className="table table-sticky-header policy-search-table">
              <thead>
                <tr>
                  <th data-mobile-label="Customer #">Customer #</th>
                  <th data-mobile-label="Type">Type</th>
                  <th data-mobile-label="Name">Name</th>
                  <th data-mobile-label="Status">Status</th>
                  <th data-mobile-label="Policies">Policies</th>
                  <th data-mobile-label="Updated">Updated</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No results
                      {canManageCustomers && !loading && (
                        <>
                          {" "}
                          -{" "}
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={openAddCustomerModal}
                          >
                            Add Customer
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  pagedCustomerResults.map((item: any) => (
                    <tr key={item.customerId || item.customerKey}>
                      <td>
                        <Link
                          to={`/customers/${encodeURIComponent(item.customerId || item.customerKey || "")}`}
                          className="table-link"
                        >
                          {item.customerKey || "-"}
                        </Link>
                      </td>
                      <td>{item.entityType || "-"}</td>
                      <td>{item.name || "-"}</td>
                      <td>{item.status || "-"}</td>
                      <td>{Number(item.policyCount || 0)}</td>
                      <td>
                        {formatDisplayDateTime(item.lastUpdated, {
                          fallback: "-",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
          <Pagination
            page={page}
            pageSize={pageSize}
            totalItems={total}
            onPageChange={(p) => {
              setPage(p);
              // Scroll to top of table (after React flushes state)
              setTimeout(() => {
                tableRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }, 0);
            }}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
              setTimeout(() => {
                tableRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }, 0);
            }}
            pageSizeOptions={[10, 25, 50, 100]}
            className="ps-pagination-footer"
          />
        </div>
      </div>
      {/* Keyboard shortcut hints */}
      <div className="ps-kbd-hints" aria-hidden="true">
        <span>
          <kbd className="ps-kbd">/</kbd> Focus search
        </span>
        <span>
          <kbd className="ps-kbd">Up/Down</kbd> Navigate
        </span>
        <span>
          <kbd className="ps-kbd">Space</kbd> Select row
        </span>
        <span>
          <kbd className="ps-kbd">E</kbd> Export
        </span>
        <span>
          <kbd className="ps-kbd">N</kbd> New Quote
        </span>
      </div>

      {contextMenu && (
        <Suspense fallback={null}>
          <PolicyContextMenuLazy
            x={contextMenu.x}
            y={contextMenu.y}
            policy={contextMenu.policy}
            onClose={() => setContextMenu(null)}
            onNavigate={navigate}
          />
        </Suspense>
      )}
      {showAddCustomerModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel modal-panel-lg">
            <div className="modal-header">
              <h3>Add Customer</h3>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowAddCustomerModal(false)}
                disabled={savingCustomer}
              >
                Close
              </button>
            </div>
            <div className="row">
              <div className="col">
                <label>Entity Type</label>
                <select
                  value={addCustomerForm.entityType}
                  onChange={(e) =>
                    setAddCustomerForm((prev) => ({
                      ...prev,
                      entityType: e.target.value as
                        | "INDIVIDUAL"
                        | "COMPANY"
                        | "BOTH",
                    }))
                  }
                  disabled={savingCustomer}
                >
                  <option value="INDIVIDUAL">Individual</option>
                  <option value="COMPANY">Company</option>
                  <option value="BOTH">Both</option>
                </select>
              </div>
              <div className="col">
                <label>Status</label>
                <select
                  value={addCustomerForm.status}
                  onChange={(e) =>
                    setAddCustomerForm((prev) => ({
                      ...prev,
                      status: e.target.value,
                    }))
                  }
                  disabled={savingCustomer}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="ACTIVE">Active</option>
                </select>
              </div>
            </div>
            {(addCustomerForm.entityType === "INDIVIDUAL" ||
              addCustomerForm.entityType === "BOTH") && (
              <div className="row">
                <div className="col">
                  <label>First Name</label>
                  <input
                    value={addCustomerForm.firstName}
                    onChange={(e) =>
                      setAddCustomerForm((prev) => ({
                        ...prev,
                        firstName: e.target.value,
                      }))
                    }
                    disabled={savingCustomer}
                  />
                </div>
                <div className="col">
                  <label>Last Name</label>
                  <input
                    value={addCustomerForm.lastName}
                    onChange={(e) =>
                      setAddCustomerForm((prev) => ({
                        ...prev,
                        lastName: e.target.value,
                      }))
                    }
                    disabled={savingCustomer}
                  />
                </div>
                <div className="col">
                  <label>DOB</label>
                  <input
                    type="date"
                    value={addCustomerForm.dob}
                    onChange={(e) =>
                      setAddCustomerForm((prev) => ({
                        ...prev,
                        dob: e.target.value,
                      }))
                    }
                    disabled={savingCustomer}
                  />
                </div>
              </div>
            )}
            {(addCustomerForm.entityType === "COMPANY" ||
              addCustomerForm.entityType === "BOTH") && (
              <div className="row">
                <div className="col">
                  <label>Legal Name</label>
                  <input
                    value={addCustomerForm.legalName}
                    onChange={(e) =>
                      setAddCustomerForm((prev) => ({
                        ...prev,
                        legalName: e.target.value,
                      }))
                    }
                    disabled={savingCustomer}
                  />
                </div>
                <div className="col">
                  <label>Incorporation State</label>
                  <input
                    value={addCustomerForm.incorporationState}
                    onChange={(e) =>
                      setAddCustomerForm((prev) => ({
                        ...prev,
                        incorporationState: e.target.value.toUpperCase(),
                      }))
                    }
                    disabled={savingCustomer}
                  />
                </div>
              </div>
            )}
            <div className="row">
              <div className="col">
                <label>Email</label>
                <input
                  value={addCustomerForm.email}
                  onChange={(e) =>
                    setAddCustomerForm((prev) => ({
                      ...prev,
                      email: e.target.value,
                    }))
                  }
                  disabled={savingCustomer}
                />
              </div>
              <div className="col">
                <label>Phone</label>
                <input
                  value={addCustomerForm.phone}
                  onChange={(e) =>
                    setAddCustomerForm((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                  disabled={savingCustomer}
                />
              </div>
            </div>
            {addCustomerError && <p className="error">{addCustomerError}</p>}
            <div className="toolbar-actions row-spaced-sm">
              <button
                type="button"
                onClick={saveQuickCustomer}
                disabled={savingCustomer}
              >
                {savingCustomer ? "Saving..." : "Add Customer"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowAddCustomerModal(false)}
                disabled={savingCustomer}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
