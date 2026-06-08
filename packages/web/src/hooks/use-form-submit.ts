import { type FormEvent, useCallback, useState } from "react";

interface UseFormSubmit {
  loading: boolean;
  error: string;
  setError: (message: string) => void;
  submit: (fn: () => Promise<void>) => (e: FormEvent) => Promise<void>;
}

export function useFormSubmit(): UseFormSubmit {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(
    (fn: () => Promise<void>) => async (e: FormEvent) => {
      e.preventDefault();
      setError("");
      setLoading(true);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { loading, error, setError, submit };
}
