import * as React from "react";

import { cn } from "../lib/utils.js";

const headingTags = { 1: "h1", 2: "h2", 3: "h3" } as const;

const headingClasses = {
  1: "text-3xl font-semibold tracking-tight",
  2: "text-xl font-semibold tracking-tight",
  3: "text-base font-semibold",
} as const;

interface HeadingProps extends React.ComponentProps<"h1"> {
  readonly level?: keyof typeof headingTags;
}

/** Semantic level and visual size travel together; a page that needs them apart is misstructured. */
export function Heading({ level = 1, className, ...props }: HeadingProps) {
  const Tag = headingTags[level];
  return <Tag data-slot="heading" className={cn(headingClasses[level], className)} {...props} />;
}

const toneClasses = {
  default: "text-foreground",
  muted: "text-muted-foreground",
  destructive: "text-destructive",
} as const;

const textSizeClasses = {
  default: "text-sm leading-relaxed",
  small: "text-xs leading-relaxed",
} as const;

interface TextProps extends React.ComponentProps<"p"> {
  readonly tone?: keyof typeof toneClasses;
  readonly size?: keyof typeof textSizeClasses;
}

export function Text({ tone = "default", size = "default", className, ...props }: TextProps) {
  return (
    <p
      data-slot="text"
      className={cn(textSizeClasses[size], toneClasses[tone], className)}
      {...props}
    />
  );
}

export function Code({ className, ...props }: React.ComponentProps<"code">) {
  return (
    <code
      data-slot="code"
      className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)}
      {...props}
    />
  );
}

export function CodeBlock({ className, ...props }: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="code-block"
      className={cn(
        "overflow-x-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}
