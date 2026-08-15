import { redirect } from "next/navigation";

/** /settings has no page of its own — Organization is the landing section. */
export default function SettingsIndexPage() {
  redirect("/settings/organization");
}
