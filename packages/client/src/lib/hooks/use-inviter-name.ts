import { useQuery } from "@tanstack/react-query";
import { fetchInviterName } from "~/lib/actions";

/** The inviter's display name for an invite token, or null until (or unless) it's known. */
export const useInviterName = (token: string | null) =>
  useQuery({
    queryKey: ["inviter-name", token],
    queryFn: () => (token ? fetchInviterName(token) : null),
    enabled: !!token,
    staleTime: Infinity,
    retry: false,
  }).data ?? null;
