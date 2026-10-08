const USDC_DECIMALS = 6;
type PaymentStatsRow = {
  paid_calls: number | string | null;
  revenue_atomic: number | string | null;
  external_paid_calls: number | string | null;
  external_revenue_atomic: number | string | null;
  last_paid_at: string | null;
  last_external_paid_at: string | null;
};

export async function stats(db: D1Database) {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS paid_calls,
         COALESCE(SUM(amount_atomic), 0) AS revenue_atomic,
         COALESCE(
           SUM(
             CASE
               WHEN is_test_buyer = 0 THEN 1
               ELSE 0
             END
           ),
           0
         ) AS external_paid_calls,
         COALESCE(
           SUM(
             CASE
               WHEN is_test_buyer = 0
               THEN amount_atomic
               ELSE 0
             END
           ),
           0
         ) AS external_revenue_atomic,
         MAX(created_at) AS last_paid_at,
         MAX(
           CASE
             WHEN is_test_buyer = 0
             THEN created_at
             ELSE NULL
           END
         ) AS last_external_paid_at
       FROM payment_events`,
    )
    .first<PaymentStatsRow>();

  const paidCalls =
    Number(row?.paid_calls ?? 0);

  const revenueAtomic =
    Number(row?.revenue_atomic ?? 0);

  const externalPaidCalls =
    Number(row?.external_paid_calls ?? 0);

  const externalRevenueAtomic =
    Number(row?.external_revenue_atomic ?? 0);

  return Response.json({
    paid_calls: paidCalls,
    test_paid_calls:
      paidCalls - externalPaidCalls,
    external_paid_calls:
      externalPaidCalls,

    revenue_usdc:
      revenueAtomic / 10 ** USDC_DECIMALS,

    external_revenue_usdc:
      externalRevenueAtomic /
      10 ** USDC_DECIMALS,

    last_paid_at:
      row?.last_paid_at ?? null,

    last_external_paid_at:
      row?.last_external_paid_at ?? null,
  });
}
