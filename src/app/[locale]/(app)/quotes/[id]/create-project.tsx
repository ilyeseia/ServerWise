"use client";

import { useLocale, useTranslations } from "next-intl";
import { useAction } from "@/components/projects/use-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { createProjectAction } from "../../projects/actions";

/** Creates the project for an accepted quotation; asking twice opens the same project. */
export function CreateProject({ quoteId }: { quoteId: string }) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const router = useRouter();
  const action = useAction();
  return (
    <div className="flex flex-col gap-3">
      {action.error ? <Alert variant="danger">{action.error}</Alert> : null}
      <p className="text-sm text-muted-foreground">{t("createHint")}</p>
      <div>
        <Button
          type="button"
          disabled={action.pending}
          onClick={() =>
            action.run(async () => {
              const result = await createProjectAction(quoteId, locale);
              if (result.ok) router.push(`/projects/${result.id}`);
              return result;
            })
          }
        >
          {t("createFromQuote")}
        </Button>
      </div>
    </div>
  );
}
