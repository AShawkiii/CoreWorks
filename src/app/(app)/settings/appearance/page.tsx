import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasPermission } from "@/server/auth/permissions";
import { getOrganization } from "@/server/services/organization";
import { getThemeSettings } from "@/server/services/theme";
import { getOrgContext } from "@/server/tenancy";

import { AppearanceForm } from "./appearance-form";

export const metadata: Metadata = {
  title: "Appearance",
};

export default async function AppearanceSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/login");
  // Reading the organization's appearance is part of reading the organization;
  // changing it needs branding:manage, checked again in the action.
  if (!hasPermission(ctx.role, "org:view")) notFound();

  const [theme, organization] = await Promise.all([
    getThemeSettings(ctx),
    getOrganization(ctx),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Brand colours and logo for {organization?.name ?? "your organization"}.
            Everyone signed in here sees them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AppearanceForm
            theme={theme}
            logoUrl={organization?.logoUrl ?? null}
            canEdit={hasPermission(ctx.role, "branding:manage")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What branding does not change</CardTitle>
          <CardDescription>
            Some colours carry meaning rather than decoration.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            Client health, task status, and priority keep their own colours —
            green for On Track, amber for At Risk, red for Delayed, grey for On
            Hold. Those come from the enumerations of the system CoreWorks
            replaces, where the same four fills drove the spreadsheet&rsquo;s
            conditional formatting and the web app&rsquo;s badges. An
            organization whose brand is red should not end up with a red
            &ldquo;On Track&rdquo;.
          </p>
          <p>
            Success, warning, danger, and information colours are fixed for the
            same reason.
          </p>
          <p>
            Dark mode is not an inversion of your palette. Each brand colour is
            re-derived so it clears a contrast floor against the dark page, and
            the text placed on it is chosen as whichever of white or near-black
            reads better. The preview above shows both.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
