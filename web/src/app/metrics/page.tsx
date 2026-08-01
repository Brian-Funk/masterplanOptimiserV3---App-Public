"use client";

import React from "react";
import MetricsBoard from "@/components/metrics/MetricsBoard";
import { EventProvider } from "@/contexts/EventContext";
import { TaskInstanceProvider } from "@/contexts/TaskInstanceContext";

export default function MetricsWindow() {
  return (
    <EventProvider>
      <TaskInstanceProvider>
        <MetricsBoard />
      </TaskInstanceProvider>
    </EventProvider>
  );
}
