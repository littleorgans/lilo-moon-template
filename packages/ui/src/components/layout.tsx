import * as React from "react";

import { cn } from "../lib/utils.js";

/*
 * The layout primitives that make the `className` ban in `apps/**` livable: app code expresses
 * layout through these props and never through utility classes. Every value maps to a literal
 * class string, because Tailwind finds classes by scanning source text and a constructed string
 * is invisible to it.
 */

const gapClasses = {
  none: "gap-0",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
  xl: "gap-8",
} as const;

export type Gap = keyof typeof gapClasses;

const alignClasses = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
} as const;

const justifyClasses = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
} as const;

interface FlexProps extends React.ComponentProps<"div"> {
  readonly gap?: Gap;
  readonly align?: keyof typeof alignClasses;
  readonly justify?: keyof typeof justifyClasses;
}

export function Stack({ gap = "md", align, justify, className, ...props }: FlexProps) {
  return (
    <div
      data-slot="stack"
      className={cn(
        "flex flex-col",
        gapClasses[gap],
        align === undefined ? undefined : alignClasses[align],
        justify === undefined ? undefined : justifyClasses[justify],
        className,
      )}
      {...props}
    />
  );
}

export function Row({ gap = "sm", align = "center", justify, className, ...props }: FlexProps) {
  return (
    <div
      data-slot="row"
      className={cn(
        "flex flex-row flex-wrap",
        gapClasses[gap],
        alignClasses[align],
        justify === undefined ? undefined : justifyClasses[justify],
        className,
      )}
      {...props}
    />
  );
}

const columnClasses = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
} as const;

interface GridProps extends React.ComponentProps<"div"> {
  readonly columns?: keyof typeof columnClasses;
  readonly gap?: Gap;
}

export function Grid({ columns = 2, gap = "md", className, ...props }: GridProps) {
  return (
    <div
      data-slot="grid"
      className={cn("grid", columnClasses[columns], gapClasses[gap], className)}
      {...props}
    />
  );
}

const containerClasses = {
  sm: "max-w-xl",
  md: "max-w-3xl",
  lg: "max-w-5xl",
} as const;

interface ContainerProps extends React.ComponentProps<"div"> {
  readonly size?: keyof typeof containerClasses;
}

export function Container({ size = "md", className, ...props }: ContainerProps) {
  return (
    <div
      data-slot="container"
      className={cn("mx-auto w-full px-6 py-10", containerClasses[size], className)}
      {...props}
    />
  );
}
