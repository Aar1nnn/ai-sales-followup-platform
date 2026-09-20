import { useCallback, useEffect, useRef, useState } from "react";
import { toUserMessage } from "./errors";

export function useSupabaseQuery(queryFactory, dependencies = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const queryRef = useRef(queryFactory);
  const dependencyKey = JSON.stringify(dependencies);
  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const { data, error } = await queryRef.current();
      if (error) throw error;
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({ data: null, loading: false, error: toUserMessage(error, "数据没有加载成功，请稍后重试。") });
    }
  }, []);
  useEffect(() => { queryRef.current = queryFactory; });
  useEffect(() => {
    if (dependencyKey === undefined) return undefined;
    const timeoutId = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [dependencyKey, refresh]);
  return { ...state, refresh };
}
