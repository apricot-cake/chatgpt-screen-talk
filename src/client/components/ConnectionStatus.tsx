import { CircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ConnectionStatusProps {
  label: string;
  tone: "idle" | "pending" | "active" | "error";
  message: string;
}

export function ConnectionStatus({
  label,
  tone,
  message,
}: ConnectionStatusProps) {
  const description = `${label}：${message}`;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-xs" aria-label={description} />
          }
        >
          <CircleIcon
            className="connection-status-dot"
            data-tone={tone}
            fill="currentColor"
            strokeWidth={0}
            aria-hidden="true"
          />
        </TooltipTrigger>
        <TooltipContent role="tooltip">{description}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status">
        {description}
      </span>
    </>
  );
}
