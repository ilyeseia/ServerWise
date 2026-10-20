import { getTranslations } from "next-intl/server";
import { OfferStateBadge } from "@/components/catalog/badges";
import { Alert, Badge } from "@/components/ui/alert";
import { Table, Td, Th } from "@/components/ui/table";
import { getAppFormatter } from "@/i18n/format";
import { Link } from "@/i18n/navigation";
import type { RecommendationView } from "@/modules/advisor/service";
import type { FactorResult, Needs, ScoredProduct } from "@/modules/advisor/types";

type Translator = (key: string, values?: Record<string, string | number>) => string;
type Evidence = Record<string, number | string | boolean | null>;

interface Ctx {
  t: Translator;
  num: (value: number) => string;
  noise: (value: string) => string;
  gpu: (value: string) => string;
  condition: (value: string) => string;
  units: (value: string) => string;
  unknown: string;
}

/** Plain-language "required" and "available" columns for one factor of the explanation. */
function describe(f: FactorResult, needs: Needs, c: Ctx): { needed: string; available: string } {
  const e = f.evidence as Evidence;
  const n = (v: unknown) => (typeof v === "number" ? c.num(v) : c.unknown);
  const dash = "—";

  switch (f.id) {
    case "performance":
      return {
        needed: c.t("detail.performance", { value: `${n(e.required)} ${c.units("cpuMark")}` }),
        available: e.actual === null ? c.unknown : `${n(e.actual)} ${c.units("cpuMark")}`,
      };
    case "ram": {
      const parts: string[] = [];
      if (typeof e.installed === "number")
        parts.push(c.t("detail.ramInstalled", { installed: n(e.installed) }));
      if (typeof e.max === "number") parts.push(c.t("detail.ramMax", { max: n(e.max) }));
      return {
        needed: c.t("detail.ram", { value: n(e.required) }),
        available: parts.length ? parts.join(" · ") : c.unknown,
      };
    }
    case "storage":
      if (f.status === "not_applicable") return { needed: dash, available: dash };
      return {
        needed: c.t("detail.storageRequired", {
          tb: n(e.requiredRawTb),
          slots: n(e.requiredSlots),
        }),
        available:
          typeof e.maxTb === "number"
            ? c.t("detail.storageAvailable", {
                tb: n(e.maxTb),
                slots: typeof e.slots === "number" ? c.num(e.slots) : dash,
              })
            : c.unknown,
      };
    case "network": {
      const needed: string[] = [];
      if (typeof e.requiredMbps === "number")
        needed.push(c.t("detail.networkRequired", { speed: c.num(e.requiredMbps / 1000) }));
      if (e.wifiRequired === true) needed.push(c.t("detail.wifiToo"));
      const available: string[] = [];
      available.push(
        typeof e.actualMbps === "number"
          ? c.t("detail.networkAvailable", { speed: c.num(e.actualMbps / 1000) })
          : c.unknown,
      );
      if (e.hasWifi === true) available.push(c.t("detail.withWifi"));
      if (e.hasWifi === false) available.push(c.t("detail.withoutWifi"));
      return { needed: needed.join(" · ") || dash, available: available.join(" · ") };
    }
    case "noise":
      return {
        needed: typeof e.allowed === "string" ? c.noise(e.allowed) : dash,
        available: typeof e.actual === "string" ? c.noise(e.actual) : c.unknown,
      };
    case "power":
      if (typeof e.limitWatts === "number") {
        return {
          needed: c.t("detail.powerLimit", { watts: c.num(e.limitWatts) }),
          available:
            typeof e.maxWatts === "number"
              ? c.t("detail.powerMax", { watts: c.num(e.maxWatts) })
              : c.unknown,
        };
      }
      return {
        needed: c.t("detail.powerEfficiency"),
        available:
          typeof e.idleWatts === "number"
            ? c.t("detail.powerIdle", { watts: c.num(e.idleWatts) })
            : c.unknown,
      };
    case "gpu":
      return {
        needed: c.t("detail.gpuRequired"),
        available: typeof e.gpu === "string" ? c.gpu(e.gpu) : c.unknown,
      };
    case "upgradeability":
      return {
        needed: c.t("detail.upgradeRequired", { ram: c.num(needs.ramGbRequired) }),
        available:
          typeof e.ramMaxGb === "number"
            ? c.t("detail.upgradeAvailable", { max: c.num(e.ramMaxGb) })
            : c.unknown,
      };
    case "warranty":
      return {
        needed: dash,
        available:
          typeof e.months === "number"
            ? c.t("detail.warrantyAvailable", {
                months: c.num(e.months),
                condition: c.condition(String(e.condition)),
              })
            : c.unknown,
      };
    case "budget":
      return {
        needed: c.t("detail.budgetRequired", { max: n(e.budgetMaxDzd) }),
        available: c.t("detail.budgetAvailable", { price: n(e.priceDzd), margin: n(e.marginDzd) }),
      };
  }
}

function statusTone(status: FactorResult["status"]): "success" | "danger" | "neutral" {
  return status === "met" ? "success" : status === "unmet" ? "danger" : "neutral";
}

export async function AdvisorResults({ view }: { view: RecommendationView }) {
  const [t, tCatalog, tNoise, tGpu, tCond, tUnits, tStatus, tFactor, tExcl, tOffer, format] =
    await Promise.all([
      getTranslations("Advisor"),
      getTranslations("Catalog"),
      getTranslations("Catalog.noise"),
      getTranslations("Catalog.gpu"),
      getTranslations("Catalog.offer.conditions"),
      getTranslations("Advisor.units"),
      getTranslations("Advisor.statuses"),
      getTranslations("Advisor.factors"),
      getTranslations("Advisor.exclusions"),
      getTranslations("Catalog.offer"),
      getAppFormatter(),
    ]);
  const tQuestion = await getTranslations("Advisor.question");

  const { output, inputs } = view;
  const ctx: Ctx = {
    t: (key, values) => (t as unknown as Translator)(key, values),
    num: (v) => format.number(v),
    noise: (v) => (tNoise as unknown as Translator)(v),
    gpu: (v) => (tGpu as unknown as Translator)(v),
    condition: (v) => (tCond as unknown as Translator)(v),
    units: (v) => (tUnits as unknown as Translator)(v),
    unknown: tCatalog("unknown"),
  };
  const date = (iso: string | Date) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  const needs = output.needs;
  const needLines: string[] = [
    `${tFactor("ram")}: ${ctx.t("detail.ram", { value: ctx.num(needs.ramGbRequired) })}`,
    `${tFactor("performance")}: ${ctx.t("detail.performance", { value: `${ctx.num(needs.cpuBenchmarkRequired)} ${tUnits("cpuMark")}` })}`,
  ];
  if (needs.storageRawTbRequired > 0) {
    needLines.push(
      `${tFactor("storage")}: ${ctx.t("detail.storageRequired", { tb: ctx.num(needs.storageRawTbRequired), slots: ctx.num(needs.storageSlotsRequired) })}`,
    );
  }
  if (needs.budgetMaxDzd !== null) {
    needLines.push(
      `${tFactor("budget")}: ${ctx.t("detail.budgetRequired", { max: ctx.num(needs.budgetMaxDzd) })}`,
    );
  }

  const assumptionText = (a: Needs["assumptions"][number]) => {
    const params = Object.fromEntries(
      Object.entries(a.params).map(([k, v]) => [
        k,
        k === "question"
          ? (tQuestion as unknown as Translator)(String(v))
          : typeof v === "number"
            ? ctx.num(v)
            : v,
      ]),
    ) as Record<string, string | number>;
    return (t as unknown as Translator)(`assumption.${a.id}`, params);
  };

  const card = (item: ScoredProduct, rank?: number) => {
    const rows = item.factors.map((f) => ({ f, ...describe(f, needs, ctx) }));
    return (
      <article
        key={item.productId}
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
        data-testid={rank ? "ranked-item" : "excluded-item"}
      >
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h4 className="text-base font-semibold">
              {rank ? <span className="me-2 text-primary">{t("rank", { rank })}</span> : null}
              <Link href={`/catalog/${item.productId}`} className="hover:underline">
                {item.brand} {item.model}
              </Link>
            </h4>
            {item.offer ? (
              <p className="text-sm">
                <strong dir="ltr">
                  {ctx.num(item.offer.priceDzd)} {tUnits("dzd")}
                </strong>{" "}
                <span className="text-muted-foreground">
                  {t("from", { supplier: item.offer.supplierName })} · {tCond(item.offer.condition)}{" "}
                  · {t("checked", { date: date(item.offer.checkedAt) })}
                </span>{" "}
                <OfferStateBadge state={item.offer.state} />{" "}
                {item.offer.sourceUrl ? (
                  <a
                    href={item.offer.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                    dir="ltr"
                  >
                    {tOffer("openSource")}
                  </a>
                ) : item.offer.quoteReference ? (
                  <span className="text-xs">{item.offer.quoteReference}</span>
                ) : null}
              </p>
            ) : null}
          </div>
          {rank ? (
            <dl className="flex gap-4 text-center text-xs">
              <div>
                <dt className="text-muted-foreground">{t("adjusted")}</dt>
                <dd className="text-lg font-bold" data-testid="adjusted-score">
                  {ctx.num(item.adjusted)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("score")}</dt>
                <dd className="text-lg font-semibold">{ctx.num(item.score)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("confidence")}</dt>
                <dd className="text-lg font-semibold">
                  {ctx.num(Math.round(item.confidence * 100))}%
                </dd>
              </div>
            </dl>
          ) : null}
        </header>

        {item.exclusions.length > 0 ? (
          <ul className="list-disc ps-5 text-sm text-danger">
            {item.exclusions.map((r) => (
              <li key={r}>{tExcl(r)}</li>
            ))}
          </ul>
        ) : null}

        {item.unusableOffers.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("unusableTitle")}:{" "}
            {item.unusableOffers.map((u) => (
              <span key={u.id} className="me-2 inline-block">
                <OfferStateBadge state={u.state} />
              </span>
            ))}
          </p>
        ) : null}

        <details>
          <summary className="cursor-pointer text-sm font-medium">{t("factorsTable")}</summary>
          <div className="mt-3">
            <Table caption={`${t("factorsTable")}: ${item.brand} ${item.model}`}>
              <thead>
                <tr>
                  <Th>{t("factor")}</Th>
                  <Th>{t("weight")}</Th>
                  <Th>{t("status")}</Th>
                  <Th>{t("needed")}</Th>
                  <Th>{t("available")}</Th>
                  <Th>{t("factorScore")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ f, needed, available }) => (
                  <tr key={f.id} data-testid={`factor-${f.id}`}>
                    <Td className="font-medium">{tFactor(f.id)}</Td>
                    <Td>{ctx.num(f.weight)}</Td>
                    <Td>
                      <Badge tone={statusTone(f.status)}>{tStatus(f.status)}</Badge>
                    </Td>
                    <Td>{needed}</Td>
                    <Td>{available}</Td>
                    <Td>{f.score === null ? "—" : ctx.num(f.score)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </details>
      </article>
    );
  };

  return (
    <div className="flex flex-col gap-6" data-testid="advisor-results">
      <p className="text-xs text-muted-foreground">
        {t("generatedAt", {
          date: format.dateTime(view.createdAt, { dateStyle: "medium", timeStyle: "short" }),
        })}
        {view.createdByName ? ` · ${t("by", { name: view.createdByName })}` : ""} ·{" "}
        {t("engine", { version: view.engineVersion })}
        {inputs.options.includeStale ? ` · ${t("includeStale")}` : ""}
        {inputs.options.includeUnverified ? ` · ${t("includeUnverified")}` : ""}
      </p>
      {inputs.requirementsStatus === "draft" ? <Alert>{t("draftNotice")}</Alert> : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{t("needsTitle")}</h3>
        <ul className="list-disc ps-5 text-sm">
          {needLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t("assumptionsTitle")}</summary>
          <p className="mt-2 text-xs text-muted-foreground">{t("assumptionsNote")}</p>
          <ul className="mt-2 list-disc ps-5 text-sm">
            {needs.assumptions.map((a, i) => (
              <li key={`${a.id}-${i}`}>{assumptionText(a)}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{t("ranked")}</h3>
        <p className="text-xs text-muted-foreground">{t("scoreHelp")}</p>
        {output.ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRanked")}</p>
        ) : (
          output.ranked.map((item, index) => card(item, index + 1))
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">{t("excluded")}</h3>
        {output.excluded.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noExcluded")}</p>
        ) : (
          output.excluded.map((item) => card(item))
        )}
      </section>

      <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}
