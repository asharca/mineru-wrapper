import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({
  className,
  checked,
  indeterminate,
  ...props
}: CheckboxPrimitive.Root.Props & {
  className?: string;
  indeterminate?: boolean;
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      checked={checked}
      indeterminate={indeterminate}
      className={cn(
        "peer grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-input shadow-xs transition-all outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-ring",
        "data-checked:bg-primary data-checked:border-primary data-checked:text-primary-foreground",
        "data-indeterminate:bg-primary data-indeterminate:border-primary data-indeterminate:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        keepMounted
        className="flex items-center justify-center text-current"
      >
        {indeterminate ? (
          <Minus className="h-3 w-3" />
        ) : (
          <Check className="h-3 w-3" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
