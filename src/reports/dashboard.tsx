/**
 * Executive Dashboards for Stage 14 — Advanced Analytics & BI
 *
 * Displays key performance indicators for the ServerWise platform.
 * Supports Arabic (RTL) and French (LTR) locales.
 * Uses recharts for data visualization.
 */

import { FC, useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
} from "@/components/ui/card";
import { Button as PrimaryButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, UseSelectOptions } from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export const DashboardKPIs = {
  revenue: "الإيرادات",
  projects: "المشاريع",
  slaCompliance: "امتثال SLA",
  averageDuration: "مدة التنفيذ المتوسطة",
  grossMargin: "هامش إجمالي",
  netMargin: "هامش صافي",
  activeAssets: "الأصول النشطة",
  customerRetention: "احتفاظ العملاء",
  ticketCount: "عدد التذاكر",
};

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: string;
  trendPositive: boolean;
  icon?: string;
}

const KPICard: FC<KPICardProps> = ({
  title,
  value,
  subtitle,
  trend,
  trendPositive = true,
  icon,
}) => {
  const classes = cn(
    "flex flex-col items-start gap-2",
    "p-4 rounded-lg border",
    "bg-white dark:bg-gray-800"
  );

  const trendClass = trendPositive ? "text-green-600" : "text-red-600";
  const trendArrow = trendPositive ? "▲" : "▼";

  return (
    <div className={classes}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{subtitle || ""}</p>
          <p className="text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</p>
        </div>
        <div className="flex items-center gap-2">
          {trend && (
            <span className={`text-${trendPositive ? "green" : "red"} text-sm`}
              >
                {trendArrow} {trend}
              </span>
            )}
        </div>
      </div>
    </div>
  );
};

interface ExecutiveDashboardProps {
  locale: string;
}

export const ExecutiveDashboard: FC<ExecutiveDashboardProps> = ({
  locale,
}) => {
  const t = useTranslations("Dashboard");
  const [selectedPeriod, setSelectedPeriod] = useState<"monthly" | "quarterly" | "yearly">("monthly");
  const [searchQuery, setSearchQuery] = useState("");

  // Sample KPI data - in production this would come from API
  const kpiData = useEffect(() => {
    // Mock data - replace with real API fetch
    return {
      revenue: 1250000,
      projects: 47,
      slaCompliance: 94,
      averageDuration: "45",
      grossMargin: "28%",
      netMargin: "15%",
      activeAssets: 23,
      customerRetention: "92%",
      ticketCount: 12,
    };
  }, []);

  // Charts data - mock
  const revenueData = useEffect(() => {
    return [
      { name: "يناير", uv: 400, pv: 2400, amt: 52000 },
      { name: "فبراير", uv: 300, pv: 1398, amt: 43000 },
      { name: "مارس", uv: 200, pv: 980, amt: 31000 },
      { name: "أبريل", uv: 278, pv: 3800, amt: 48000 },
      { name: "مايو", uv: 189, pv: 3938, amt: 42000 },
      { name: "يونيو", uv: 239, pv: 4800, amt: 51000 },
    ];
  }, []);

  const projectsData = useEffect(() => {
    return [
      { name: "منجزة", uv: 24 },
      { name: "في التقدم", uv: 18 },
      { name: "معلقة", uv: 5 },
    ];
  }, []);

  return (
    <div className="space-y-6">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          title={DashboardKPIs.revenue}
          value={kpiData.revenue}
          subtitle="MRR (Monthly Recurring Revenue)"
          trend={"+12%"}
          trendPositive={true}
        />
        <KPICard
          title={DashboardKPIs.projects}
          value={kpiData.projects}
          subtitle="المشاريع الإجمالية"
          trend={"+5"}
          trendPositive={true}
        />
        <KPICard
          title={DashboardKPIs.slaCompliance}
          value={kpiData.slaCompliance}
          subtitle="امتثال SLA"
          trend={"+3%"}
          trendPositive={true}
        />
        <KPICard
          title={DashboardKPIs.averageDuration}
          value={kpiData.averageDuration}
          subtitle="أيام (متوسط)"
          trend={"-5"}
          trendPositive={false}
        />
        <KPICard
          title={DashboardKPIs.grossMargin}
          value={kpiData.grossMargin}
          subtitle="هامش إجمالي"
          trend={"+2%"}
          trendPositive={true}
        />
        <KPICard
          title={DashboardKPIs.netMargin}
          value={kpiData.netMargin}
          subtitle="هامش صافي"
          trend={"+1%"}
          trendPositive={true}
        />
        <KPICard
          title={DashboardKPIs.activeAssets}
          value={kpiData.activeAssets}
          subtitle="الأصول النشطة"
          trend={"+8"}
          trendPositive={true}
        />
        <KPICard
          title={DashboardKPIs.customerRetention}
          value={kpiData.customerRetention}
          subtitle="معدل الاحتفاظ"
          trend={"+4%"}
          trendPositive={true}
        />
        <KPICard
          title={DashboardKPIs.ticketCount}
          value={kpiData.ticketCount}
          subtitle="عدد التذاكر المفتوحة"
          trend={"-3"}
          trendPositive={false}
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Revenue Chart */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>{t("revenueChartTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={revenueData}>
                  <XAxis dataName="name" stroke="#8884d8" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" name="الإيرادات" fill="#8884d8" />
                  <Bar dataKey="amount" name="القيمة" fill="#82ca9d" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Projects Status Chart */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>{t("projectsStatusTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart data={projectsData}>
                  <Pie dataKey="uv" name="اسم المشروع">
                    <Cell
                      fill="#8884d8"
                    />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* SLA Compliance */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>{t("slaComplianceTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[{ name: "مطابقة", uv: kpiData.slaCompliance }]} stroke="#8884d8">
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="uv" name="٪ مطابقة" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Filters and Actions */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            {t("period")}
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value as "monthly" | "quarterly" | "yearly")}
              className="block w-full rounded-md border border-gray-300 bg-white py-2.5 pl-3 pr-8 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
            >
              <option value="monthly">{t("monthly")}</option>
              <option value="quarterly">{t("quarterly")}</option>
              <option value="yearly">{t("yearly")}</option>
            </select>
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">
            {t("search")}
            <Input
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="block w-full rounded-md border border-gray-300 bg-white py-2.5 pl-3 pr-8 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600"
            />
          </label>
        </div>
        <PrimaryButton variant="secondary" size="sm">
          {t("exportPDF")}
        </PrimaryButton>
        <PrimaryButton variant="secondary" size="sm">
          {t("exportExcel")}
        </PrimaryButton>
        <PrimaryButton variant="secondary" size="sm">
          {t("exportCSV")}
        </PrimaryButton>
      </div>
    </div>
  );
};