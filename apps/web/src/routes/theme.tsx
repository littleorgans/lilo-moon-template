import { ThemeLab } from "@lilo-moon/views/theme-lab";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

// The preference is the root route's loader data: the root already needed it to stamp `<html>`,
// and reading it from there keeps this page from running a second cookie round-trip.
const rootApi = getRouteApi("__root__");

export const Route = createFileRoute("/theme")({
  component: ThemePage,
});

function ThemePage() {
  return <ThemeLab preference={rootApi.useLoaderData()} setPath="/api/theme" />;
}
