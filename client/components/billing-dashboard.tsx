"use client";

import { useEffect, useState, useCallback } from "react";
import {
  CreditCard,
  Coins,
  CheckCircle2,
  RefreshCw,
  Zap,
  ExternalLink,
  Check,
  X,
  Layers,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import styles from "./workspace-sections.module.css";
import type {
  Project,
  BillingOverview,
  PlanTier,
  CreditCategory,
} from "../lib/types";

interface BillingDashboardProps {
  tenantId: string;
  project: Project;
}

interface BillingLoadError {
  message: string;
  requestId?: string;
}

export function BillingDashboard({ tenantId }: BillingDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loadedTenantId, setLoadedTenantId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<BillingLoadError | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Top-up Modal
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [processingCheckout, setProcessingCheckout] = useState(false);

  // Ledger Filter
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState<"all" | CreditCategory>("all");

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const fetchBilling = useCallback(async () => {
    return api.request<BillingOverview>(`/v1/billing/tenants/${tenantId}/overview`);
  }, [tenantId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      setOverview(await fetchBilling());
      setLoadedTenantId(tenantId);
      showToast("Billing and credit balances refreshed.");
    } catch (err) {
      if (loadedTenantId !== tenantId) {
        setOverview(null);
        setLoadedTenantId(tenantId);
      }
      setLoadError(
        err instanceof ApiError
          ? { message: err.message, requestId: err.requestId }
          : { message: "Failed to load billing details. Please try again." },
      );
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    fetchBilling()
      .then((data) => {
        if (!ignore) {
          setOverview(data);
          setLoadedTenantId(tenantId);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setOverview(null);
          setLoadedTenantId(tenantId);
          setLoadError(
            err instanceof ApiError
              ? { message: err.message, requestId: err.requestId }
              : { message: "Failed to load billing details. Please try again." },
          );
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [fetchBilling, tenantId]);

  const handleUpgradeOrDowngrade = async (targetTier: PlanTier) => {
    if (overview?.subscription.stripeSubscriptionId && !["canceled", "incomplete_expired"].includes(overview.subscription.status)) {
      await handleOpenStripePortal();
      return;
    }
    setProcessingCheckout(true);
    try {
      const res = await api.request<{ url: string }>(`/v1/billing/tenants/${tenantId}/checkout`, {
        method: "POST",
        body: {
          planTier: targetTier,
          returnUrl: typeof window !== "undefined" ? window.location.href : "http://localhost:3000/billing",
        },
      });

      if (res.url) {
        window.location.assign(res.url);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to initiate Stripe Checkout";
      showToast(msg);
      setProcessingCheckout(false);
    }
  };

  const handleTopupCredits = async () => {
    setProcessingCheckout(true);
    try {
      const res = await api.request<{ url: string }>(`/v1/billing/tenants/${tenantId}/checkout`, {
        method: "POST",
        body: {
          planTier: "topup_1000",
          returnUrl: typeof window !== "undefined" ? window.location.href : "http://localhost:3000/billing",
        },
      });

      if (res.url) {
        window.location.assign(res.url);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to initiate top-up checkout";
      showToast(msg);
      setProcessingCheckout(false);
    }
  };

  const handleOpenStripePortal = async () => {
    try {
      const res = await api.request<{ url: string }>(`/v1/billing/tenants/${tenantId}/portal`, {
        method: "POST",
        body: {
          returnUrl: typeof window !== "undefined" ? window.location.href : "http://localhost:3000/billing",
        },
      });

      if (res.url) {
        window.location.assign(res.url);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to launch Stripe Customer Portal";
      showToast(msg);
    }
  };

  const filteredLedger = overview?.recentLedger.filter((entry) => {
    if (ledgerCategoryFilter === "all") return true;
    return entry.category === ledgerCategoryFilter;
  }) || [];

  return (
    <div className={`${styles.page} ${styles.reportingPage}`}>
      {/* Toast */}
      {toastMessage && (
        <div className="toast-banner">
          <CheckCircle2 size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className={`reporting-header ${styles.header} ${styles.reportingHeader}`}>
        <div className={styles.headerCopy}>
          <p className={`${styles.eyebrow} ${styles.reportingEyebrow}`}>
            <CreditCard size={13} />
            <span>M15 BILLING & CREDIT LEDGER</span>
          </p>
          <h1 className={styles.sectionTitle}>Plan Subscription & Credit Metering</h1>
          <p className={`${styles.description} ${styles.billingDescription}`}>
            Manage your organization&apos;s subscription tier, credit allowances, and immutable transaction history.
          </p>
        </div>

        <div className={`${styles.headerActions} ${styles.reportingHeaderActions}`}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
          <button
            onClick={handleOpenStripePortal}
            className="btn btn-secondary flex items-center gap-2 text-xs"
          >
            <ExternalLink size={13} />
            <span>Stripe Customer Portal</span>
          </button>
          <button
            onClick={() => setShowTopupModal(true)}
            className="btn btn-primary flex items-center gap-2 text-xs"
          >
            <Zap size={14} />
            <span>Top-Up Credits</span>
          </button>
        </div>
      </div>

      {loading || loadedTenantId !== tenantId ? (
        <div
          className={styles.loadingState}
          role="status"
          aria-live="polite"
        >
          <RefreshCw size={28} className="animate-spin mb-3 text-blue-500" />
          <p className="text-sm font-medium">Loading subscription and credit ledger...</p>
        </div>
      ) : !overview ? (
        <div className={styles.emptyState} role="alert">
          <CreditCard size={28} aria-hidden="true" />
          <h2 className="text-base font-semibold">Unable to load billing details</h2>
          <p>{loadError?.message ?? "Billing information is currently unavailable."}</p>
          {loadError?.requestId && (
            <small>Reference ID: {loadError.requestId}</small>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            <span>Try again</span>
          </button>
        </div>
      ) : (
        <>
        {loadError && (
          <div className="audit-alert audit-alert-error" role="alert">
            <span>{loadError.message}</span>
            {loadError.requestId && (
              <small>Reference ID: {loadError.requestId}</small>
            )}
          </div>
        )}
        <div className="flex flex-col gap-6">
          {/* Active Plan Banner & Balances */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Subscription Summary Card */}
            <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs uppercase font-bold tracking-wider text-gray-400">Current Subscription</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                      overview.subscription.status === "active"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {overview.subscription.status}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-3xl font-extrabold text-gray-900 dark:text-white capitalize">
                    {overview.subscription.planTier} Plan
                  </span>
                  <span className="text-sm text-gray-500">
                    ${overview.plans[overview.subscription.planTier]?.priceUsdMonthly}/mo
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Includes {overview.subscription.monthlyCredits.toLocaleString()} monitoring runs &amp;{" "}
                  {overview.subscription.monthlyCrawlCredits.toLocaleString()} crawl pages per month.
                </p>
              </div>

              <div className="text-[11px] text-gray-400 mt-4 pt-3 border-t dark:border-gray-800 flex items-center justify-between">
                <span>
                  {overview.subscription.currentPeriodEnd
                    ? `Renews on ${new Date(overview.subscription.currentPeriodEnd).toLocaleDateString()}`
                    : "No active expiration"}
                </span>
                <span className="text-blue-600 dark:text-blue-400 font-semibold cursor-pointer" onClick={handleOpenStripePortal}>
                  Billing details &rarr;
                </span>
              </div>
            </div>

            {/* Monitoring Credits Balance */}
            <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold tracking-wider text-gray-400 flex items-center gap-1.5">
                    <Coins size={14} className="text-amber-500" />
                    Monitoring Run Balance
                  </span>
                  <span className="text-[11px] font-semibold text-gray-500">1 Run = 1 Credit</span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white my-1">
                  {overview.balances.monitoring.available.toLocaleString()}{" "}
                  <span className="text-xs font-normal text-gray-400">available</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden my-2">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          5,
                          (overview.balances.monitoring.available /
                            Math.max(1, overview.subscription.monthlyCredits)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="text-[11px] text-gray-500 flex items-center justify-between mt-2 pt-2 border-t dark:border-gray-800">
                <span>Used this cycle: {overview.balances.monitoring.used.toLocaleString()}</span>
                <button
                  onClick={() => setShowTopupModal(true)}
                  className="text-amber-600 dark:text-amber-400 font-bold hover:underline"
                >
                  + Add 1,000 Credits
                </button>
              </div>
            </div>

            {/* Crawl Credits Balance */}
            <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold tracking-wider text-gray-400 flex items-center gap-1.5">
                    <Layers size={14} className="text-blue-500" />
                    Crawl Page Balance
                  </span>
                  <span className="text-[11px] font-semibold text-gray-500">1 Page = 1 Credit</span>
                </div>
                <div className="text-3xl font-extrabold text-gray-900 dark:text-white my-1">
                  {overview.balances.crawl.available.toLocaleString()}{" "}
                  <span className="text-xs font-normal text-gray-400">available</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-800 h-2 rounded-full overflow-hidden my-2">
                  <div
                    className="bg-blue-500 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          5,
                          (overview.balances.crawl.available /
                            Math.max(1, overview.subscription.monthlyCrawlCredits)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <div className="text-[11px] text-gray-500 flex items-center justify-between mt-2 pt-2 border-t dark:border-gray-800">
                <span>Used: {overview.balances.crawl.used.toLocaleString()} pages</span>
                <span className="text-gray-400">Separate technical metering</span>
              </div>
            </div>
          </div>

          {/* 3-Tier Plan Comparison Grid */}
          <div className="panel p-6 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
            <div className="mb-6">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">Subscription Plans</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Choose the plan that fits your brand&apos;s monitoring frequency, prompt scale, and technical crawling needs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {(Object.keys(overview.plans) as PlanTier[]).map((tierKey) => {
                const plan = overview.plans[tierKey];
                const isCurrent = overview.subscription.planTier === tierKey;

                return (
                  <div
                    key={tierKey}
                    className={`p-5 rounded-xl border flex flex-col justify-between transition-all ${
                      isCurrent
                        ? "border-blue-600 bg-blue-50/20 dark:bg-blue-950/20 shadow-md ring-2 ring-blue-600/30"
                        : "border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-sm text-gray-900 dark:text-white">{plan.name}</span>
                        {isCurrent && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white uppercase">
                            Current Plan
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-1 my-3">
                        <span className="text-3xl font-extrabold text-gray-900 dark:text-white">
                          ${plan.priceUsdMonthly}
                        </span>
                        <span className="text-xs text-gray-500">/month</span>
                      </div>

                      <ul className="flex flex-col gap-2.5 text-xs text-gray-600 dark:text-gray-300 my-4">
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 flex-shrink-0" />
                          <span>{plan.monthlyCredits.toLocaleString()} monitoring runs / mo</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 flex-shrink-0" />
                          <span>{plan.monthlyCrawlCredits.toLocaleString()} technical crawl pages</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 flex-shrink-0" />
                          <span>Up to {plan.maxPrompts.toLocaleString()} monitored prompts</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 flex-shrink-0" />
                          <span>Gemini, ChatGPT, AI Overviews &amp; AI Mode</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-emerald-500 flex-shrink-0" />
                          <span>Statistical drop alerts &amp; weekly PDF briefs</span>
                        </li>
                      </ul>
                    </div>

                    <div className="pt-4 mt-2 border-t dark:border-gray-800">
                      {isCurrent ? (
                        <button
                          disabled
                          className="w-full py-2 text-xs font-bold rounded bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed"
                        >
                          Active Plan
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUpgradeOrDowngrade(tierKey)}
                          disabled={processingCheckout}
                          className="w-full py-2 text-xs font-bold rounded btn-primary"
                        >
                          {tierKey === "enterprise" ? "Upgrade to Enterprise" : `Switch to ${plan.name}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Credit Ledger History Table */}
          <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b dark:border-gray-800">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Credit Ledger Transactions</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Immutable accounting history of all credit grants, run deductions, and crawl operations
                </p>
              </div>

              <div className="flex items-center gap-2">
                {(["all", "monitoring", "crawl"] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setLedgerCategoryFilter(cat)}
                    className={`px-3 py-1 text-xs rounded-full capitalize font-medium transition ${
                      ledgerCategoryFilter === cat
                        ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm"
                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {filteredLedger.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-xs">
                No ledger transactions recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b dark:border-gray-800 text-gray-400 font-semibold">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Category</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Balance After</th>
                      <th className="py-2.5 px-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredLedger.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="py-2.5 px-3 text-gray-500">
                          {new Date(item.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                            {item.entryType.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 capitalize text-gray-600 dark:text-gray-400">
                          {item.category}
                        </td>
                        <td className="py-2.5 px-3 font-bold">
                          <span
                            className={item.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-700 dark:text-gray-300"}
                          >
                            {item.amount > 0 ? `+${item.amount}` : item.amount}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-gray-900 dark:text-white">
                          {item.balanceAfter.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-gray-500 max-w-xs truncate">
                          {item.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/* MODAL: TOP-UP CREDITS */}
      {showTopupModal && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between pb-3 border-b dark:border-gray-800">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Zap size={16} className="text-amber-500" />
                <span>Purchase Top-Up Credits</span>
              </h3>
              <button onClick={() => setShowTopupModal(false)} className="text-gray-400 hover:text-black">
                <X size={16} />
              </button>
            </div>

            <div className="my-4 text-xs">
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
                Add extra monitoring runs immediately without changing your monthly subscription plan. Top-up credits
                never expire and roll over between billing cycles.
              </p>

              <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 flex items-center justify-between">
                <div>
                  <div className="font-bold text-sm text-gray-900 dark:text-white">1,000 Monitoring Credits</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">Instant allocation to your balance</div>
                </div>
                <div className="text-xl font-extrabold text-gray-900 dark:text-white">$50.00</div>
              </div>

              <div className="flex justify-end gap-2 mt-6 pt-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowTopupModal(false)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTopupCredits}
                  disabled={processingCheckout}
                  className="btn btn-primary text-xs flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700"
                >
                  {processingCheckout ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Redirecting...</span>
                    </>
                  ) : (
                    <>
                      <CreditCard size={13} />
                      <span>Checkout via Stripe</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
