import React, { useEffect, useMemo, useState } from "react";
import { Input, type InputProps } from "./Input";
import { formatDateShort } from "@/lib/dateFormat";

type SwissDateInputProps = Omit<
  InputProps,
  "type" | "value" | "onChange" | "min" | "max"
> & {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
};

/** Render a date input that displays Swiss DD.MM.YYYY while storing ISO dates. */
export function SwissDateInput({
  value,
  onChange,
  min,
  max,
  error,
  helperText,
  placeholder = "DD.MM.YYYY",
  onBlur,
  ...props
}: SwissDateInputProps) {
  const [text, setText] = useState(() => formatIsoDateForInput(value));
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    setText(formatIsoDateForInput(value));
    setLocalError(undefined);
  }, [value]);

  const resolvedError = error || localError;
  const resolvedHelperText = useMemo(
    () => helperText || "Use DD.MM.YYYY, for example 12.10.2015.",
    [helperText],
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextText = event.target.value;
    setText(nextText);

    if (!nextText.trim()) {
      setLocalError(undefined);
      onChange("");
      return;
    }

    const isoDate = parseSwissDateInput(nextText);
    if (!isoDate) {
      setLocalError("Use DD.MM.YYYY.");
      onChange("");
      return;
    }

    if (min && isoDate < min) {
      setLocalError(`Date must not be before ${formatDateShort(min)}.`);
      onChange("");
      return;
    }

    if (max && isoDate > max) {
      setLocalError(`Date must not be after ${formatDateShort(max)}.`);
      onChange("");
      return;
    }

    setLocalError(undefined);
    onChange(isoDate);
  };

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const isoDate = parseSwissDateInput(text);
    if (isoDate) {
      setText(formatDateShort(isoDate));
    }
    onBlur?.(event);
  };

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
      error={resolvedError}
      helperText={resolvedHelperText}
    />
  );
}

function formatIsoDateForInput(value?: string | null): string {
  return value ? formatDateShort(value) : "";
}

function parseSwissDateInput(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0",
  )}`;
}
