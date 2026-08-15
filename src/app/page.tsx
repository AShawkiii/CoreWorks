import { redirect } from "next/navigation";

import { getCurrentUserId } from "@/server/tenancy";

export default async function RootPage() {
  redirect((await getCurrentUserId()) ? "/dashboard" : "/login");
}
