"use client";
import { useSession } from "./session";
export function useDestinations() {
  const { user } = useSession();
  const staff = user?.role === "STAFF" || user?.role === "ADMIN";
  return { staff, cabinetHref: staff ? "/staff" : user ? "/my" : "/login?next=%2Fmy", proposalHref: staff ? "/staff" : "/ideas/new" };
}
