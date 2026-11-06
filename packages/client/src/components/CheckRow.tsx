import { Checkbox, checkboxDoneClass } from "~/components/ui/checkbox";
import { listRowVariants } from "~/components/ui/list-row";
import { cn } from "~/lib/utils";

type CheckRowProps = {
  label: string;
  detail?: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** A setting that's on or off: its label, and a line saying what it does. */
export function CheckRow({ label, detail, checked, disabled, onCheckedChange }: CheckRowProps) {
  return (
    <label
      className={cn(
        listRowVariants(),
        "cursor-pointer items-start touch:py-3",
        disabled && "cursor-not-allowed hover:bg-transparent",
      )}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        // A page of settings that are all on shouldn't be a wall of solid green
        className={cn("mt-0.5", checkboxDoneClass)}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-sm font-medium", disabled ? "text-hint" : "text-foreground")}>
          {label}
        </span>
        {detail && <span className="text-xs text-hint">{detail}</span>}
      </span>
    </label>
  );
}
