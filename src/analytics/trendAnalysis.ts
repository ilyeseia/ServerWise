/**
 * Advanced Analytics — Trend Analysis
 *
 * Calculates trends over time for various metrics.
 * Supports monthly, quarterly, and yearly analysis.
 * Arabic/French locale support built-in.
 */

import { prisma } from "@/generated/prisma/client";
import { getTranslations } from "next-intl/server";

interface TrendPoint {
  period: string; // "YYYY-MM" or "YYYY-Q" or "YYYY"
  value: number;
  label: string;
}

interface TrendAnalysisResult {
  title: string;
  description: string;
  points: TrendPoint[];
  overallTrend: "up" | "down" | "stable";
  period: "monthly" | "quarterly" | "yearly";
}

/**
 * Calculate monthly trend for a numeric metric
 */
export async function calculateMonthlyTrend(
  startDate: Date,
  endDate: Date,
  metric: "revenue" | "projects" | "tickets" | "assets",
): Promise<TrendAnalysisResult> {
  const t = await getTranslations("Analytics");

  // Fetch data from database
  const now = new Date();
  const start = startDate || new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000); // 12 months ago
  const end = endDate || now;

  let data: Array<{ date: Date; value: number }>;

  switch (metric) {
    case "revenue":
      // Fetch revenue data from reports or invoices
      data = await prisma.$executeRaw`
        SELECT DATE_TRUNC('month', createdAt) as month,
               SUM(amount) as total
        FROM reports
        WHERE createdAt >= ${start} AND createdAt <= ${end}
        GROUP BY DATE_TRUNC('month', createdAt)
        ORDER BY month
      `;
      break;
    case "projects":
      data = await prisma.$executeRaw`
        SELECT DATE_TRUNC('month', createdAt) as month,
               COUNT(*) as total
        FROM projects
        WHERE createdAt >= ${start} AND createdAt <= ${end}
        GROUP BY DATE_TRUNC('month', createdAt)
        ORDER BY month
      `;
      break;
    case "tickets":
      data = await prisma.$executeRaw`
        SELECT DATE_TRUNC('month', createdAt) as month,
               COUNT(*) as total
        FROM tickets
        WHERE createdAt >= ${start} AND createdAt <= ${end}
        GROUP BY DATE_TRUNC('month', createdAt)
        ORDER BY month
      `;
      break;
    case "assets":
      data = await prisma.$executeRaw`
        SELECT DATE_TRUNC('month', createdAt) as month,
               COUNT(*) as total
        FROM assets
        WHERE createdAt >= ${start} AND createdAt <= ${end}
        GROUP BY DATE_TRUNC('month', createdAt)
        ORDER BY month
      `;
      break;
    default:
      data = [];
  }

  // Build trend points
  const points: TrendPoint[] = [];
  let prevValue = 0;
  let trendDirection: "up" | "down" | "stable" = "stable";

  // Sort data by date
  data.sort((a, b) => (a.month as Date).getTime() - (b.month as Date).getTime());

  // Generate 12 monthly points (or fewer if data is limited)
  const monthsInPeriod = 12;
  const monthNamesAr = [
    "يناير", "فبراير", "مارس", " أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];
  const monthNamesFr = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];

  for (let i = 0; i < monthsInPeriod; i++) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    // Find matching data point
    const matchingData = data.find(
      (d) => d.month?.toISOString()?.split("T")[0] === monthKey,
    );

    const value = matchingData ? matchingData.value : 0;
    const changePercent = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : 0;
    prevValue = value;

    let trendDirectionThisPoint: "up" | "down" | "stable" = "stable";
    if (i > 0) {
      if (changePercent > 5) trendDirectionThisPoint = "up";
      else if (changePercent < -5) trendDirectionThisPoint = "down";
    }

    // Determine overall trend
    if (i >= 3) {
      // Simple trend calculation over last 4 points
      const firstVal = points[0]?.value || 0;
      const lastVal = value;
      const change = (lastVal - firstVal) / firstVal * 100;
      if (change > 5) trendDirection = "up";
      else if (change < -5) trendDirection = "down";
    }

    points.push({
      period: monthNamesAr[i], // Will be replaced based on locale
      value,
      label: `${value} ${t("dollar")}`, // Will be localized
    });
  }

  // Determine overall trend
  if (points.length >= 4) {
    const firstVal = points[0].value;
    const lastVal = points[points.length - 1].value;
    const change = (lastVal - firstVal) / firstVal * 100;
    if (change > 5) overallTrend = "up";
    else if (change < -5) overallTrend = "down";
  }

  return {
    title: t(`analytics.trend.${metric}`),
    description: t(`analytics.trend.${metric}.description`),
    points,
    overallTrend,
    period: "monthly",
  };
}

/**
 * Calculate quarterly trend
 */
export async function calculateQuarterlyTrend(
  metric: "revenue" | "projects" | "tickets",
): Promise<TrendAnalysisResult> {
  // Similar to monthly but with quarterly grouping
  const t = await getTranslations("Analytics");

  const quarterNamesAr = [
    "الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع",
  ];
  const quarterNamesFr = [
    "Q1", "Q2", "Q3", "Q4",
  ];

  // Fetch data grouped by quarter
  const data = await prisma.$executeRaw`
    SELECT DATE_TRUNC('quarter', createdAt) as quarter,
           COUNT(*) as total
    FROM reports
    WHERE createdAt >= DATE_TRUNC('year', CURRENT_DATE - INTERVAL '2 years')
    GROUP BY DATE_TRUNC('quarter', createdAt)
    ORDER BY quarter
  `;

  const points: TrendPoint[] = [];
  let prevValue = 0;
  let overallTrend: "up" | "down" | "stable" = "stable";

  const quarters: any[] = [];
  // Get last 4 quarters
  const today = new Date();
  for (let i = 0; i < 4; i++) {
    const quarterDate = new Date(today);
    quarterDate.setMonth(today.getMonth() - (i * 3));
    const quarterKey = `${quarterDate.getFullYear()}-Q${Math.floor(quarterDate.getMonth() / 3) + 1}`;
    quarters.push(quarterKey);
  }

  quarters.forEach((key, i) => {
    const matchingData = data.find(
      (d) => d.quarter?.toISOString()?.split("T")[0] === key,
    );
    const value = matchingData ? matchingData.total : 0;
    const changePercent = prevValue > 0 ? ((value - prevValue) / prevValue) * 100 : 0;
    prevValue = value;

    points.push({
      period: quarterNamesAr[i],
      value,
      label: `${value} ${t("projects")}`,
    });
  });

  // Determine overall trend
  if (points.length >= 3) {
    const firstVal = points[0].value;
    const lastVal = points[points.length - 1].value;
    const change = (lastVal - firstVal) / firstVal * 100;
    if (change > 5) overallTrend = "up";
    else if (change < -5) overallTrend = "down";
  }

  return {
    title: t("analytics.trend.quarterly"),
    description: t("analytics.trend.quarterly.description"),
    points,
    overallTrend,
    period: "quarterly",
  };
}

/**
 * Calculate correlation between two metrics
 */
export async function calculateCorrelation(
  metric1: "revenue" | "projects" | "tickets" | "assets",
  metric2: "revenue" | "projects" | "tickets" | "assets",
): Promise<{
  correlation: number; // -1 to 1
  description: string;
  interpretation: string;
}> {
  const t = await getTranslations("Analytics");

  // Fetch both metrics' data
  const data1 = await prisma.$executeRaw`
    SELECT DATE_TRUNC('month', createdAt) as month,
           ${metric1 === "revenue" ? "SUM(amount)" : metric1 === "projects" ? "COUNT(*)" : metric1 === "tickets" ? "COUNT(*)" : "COUNT(*)"} as value
    FROM reports
    WHERE createdAt >= DATE_TRUNC('year', CURRENT_DATE - INTERVAL '2 years')
    GROUP BY DATE_TRUNC('month', createdAt)
    ORDER BY month
  `;

  const data2 = await prisma.$executeRaw`
    SELECT DATE_TRUNC('month', createdAt) as month,
           ${metric2 === "revenue" ? "SUM(amount)" : metric2 === "projects" ? "COUNT(*)" : metric2 === "tickets" ? "COUNT(*)" : "COUNT(*)"} as value
    FROM reports
    WHERE createdAt >= DATE_TRUNC('year', CURRENT_DATE - INTERVAL '2 years')
    GROUP BY DATE_TRUNC('month', createdAt)
    ORDER BY month
  `;

  // Calculate Pearson correlation coefficient
  const n = data1.length;
  if (n < 3) {
    return { correlation: 0, description: t("analytics.correlation.insufficientData"), interpretation: t("analytics.correlation.insufficientData") };
  }

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;

  data1.forEach((d1, i) => {
    const v1 = parseFloat(d1.value as string || "0");
    const v2 = parseFloat(data2[i]?.value as string || "0");
    sumX += v1;
    sumY += v2;
    sumXY += v1 * v2;
    sumX2 += v1 * v1;
    sumY2 += v2 * v2;
  });

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  const correlation = denominator === 0 ? 0 : numerator / denominator;

  // Interpret correlation
  let interpretation: string;
  if (Math.abs(correlation) >= 0.7) {
    interpretation = t("analytics.correlation.strong");
  } else if (Math.abs(correlation) >= 0.3) {
    interpretation = t("analytics.correlation.moderate");
  } else {
    interpretation = t("analytics.correlation.weak");
  }

  return {
    correlation,
    description: t(`analytics.correlation.${correlation > 0 ? "positive" : "negative"}`),
    interpretation,
  };
}

export { calculateMonthlyTrend, calculateQuarterlyTrend, calculateCorrelation };