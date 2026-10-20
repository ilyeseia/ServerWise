import * as React from "react";
import { cn } from "@/lib/utils";

/** Scrollable wrapper keeps wide tables usable on phones. */
export function Table({
  className,
  caption,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { caption: string }) {
  return (
    // A scrollable region must be reachable by keyboard (WCAG 2.1.1) and have a name.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-xl border border-border"
    >
      <table className={cn("w-full text-start text-sm", className)} {...props}>
        <caption className="sr-only">{caption}</caption>
        {props.children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "bg-muted px-4 py-2 text-start text-xs font-semibold whitespace-nowrap text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-t border-border px-4 py-3 align-top", className)} {...props} />;
}
