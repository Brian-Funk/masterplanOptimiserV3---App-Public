"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CapabilitiesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/settings?section=capabilities");
  }, [router]);

  return null;
}
