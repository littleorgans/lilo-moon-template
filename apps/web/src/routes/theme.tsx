import { ThemeLab } from "@littleorgans/views/theme-lab";
import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";

import { SHOW_THEME_LAB } from "../server/product.js";

// The preference is the root route's loader data: the root already needed it to stamp `<html>`,
// and reading it from there keeps this page from running a second cookie round-trip.
const rootApi = getRouteApi("__root__");

export const Route = createFileRoute("/theme")({
  // A reference page, not a product one: production defaults to 404. See SHOW_THEME_LAB for the opt-in.
  beforeLoad: () => {
    if (!SHOW_THEME_LAB) throw notFound();
  },
  component: ThemePage,
});

function ThemePage() {
  return <ThemeLab preference={rootApi.useLoaderData()} setPath="/api/theme" />;
}
