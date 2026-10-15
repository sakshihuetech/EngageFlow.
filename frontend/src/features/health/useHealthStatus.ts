import { useCallback, useEffect, useState } from 'react';
import { healthApi } from '../../services/api/client';
import type { LivenessData, ReadinessData } from '../../services/api/types';

interface HealthState {
  loading: boolean;
  live?: LivenessData;
  ready?: ReadinessData;
  error?: string;
}

export function useHealthStatus() {
  const [state, setState] = useState<HealthState>({ loading: true });

  const refresh = useCallback(async () => {
    setState({ loading: true });
    try {
      const [live, ready] = await Promise.all([healthApi.live(), healthApi.ready()]);
      setState({ loading: false, live, ready });
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Health status could not be loaded.',
      });
    }
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([healthApi.live(), healthApi.ready()])
      .then(([live, ready]) => {
        if (active) setState({ loading: false, live, ready });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : 'Health status could not be loaded.',
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { ...state, refresh };
}
