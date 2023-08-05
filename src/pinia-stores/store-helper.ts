import { StoreDefinition, StateTree } from "pinia";
import type { DeepReadonly } from "ts-essentials";

type ToReadonlyStoreDefinition<SD> = SD extends StoreDefinition<
  infer Id,
  infer S,
  infer G,
  infer A
>
  ? StoreDefinition<Id, DeepReadonly<S>, G, A>
  : SD;

export function toReadonlyStoreDefinition<SD>(useStore: SD) {
  return useStore as ToReadonlyStoreDefinition<SD>;
}

export type UseStoreAsState<
  Id extends string,
  State extends StateTree,
  Getters,
  Actions
> = {
  state: ReturnType<
    ToReadonlyStoreDefinition<StoreDefinition<Id, State, Getters, Actions>>
  >;
  defMut: <Payloads extends unknown[]>(
    mutation: Mutation<State, Payloads>
  ) => MutationDefinition<State, Payloads>;
  defAct: <Payloads extends unknown[], Ret>(
    action: Action<Payloads, Ret>
  ) => Action<Payloads, Ret>;
};
export const useStoreAsState = <
  Id extends string,
  State extends StateTree,
  Getters,
  Actions
>(
  useStore: StoreDefinition<Id, State, Getters, Actions>
): UseStoreAsState<Id, State, Getters, Actions> => {
  const store = useStore();
  return {
    state: store,
    defMut: (mutation) => ({
      mut: mutation,
      act: (...payloads) =>
        store.$patch((state) => mutation(state, ...payloads)),
    }),
    defAct: (action) => action,
  } as UseStoreAsState<Id, State, Getters, Actions>;
};

type Mutation<State extends StateTree, Payloads extends unknown[]> = (
  state: State,
  ...payloads: Payloads
) => void;
type Action<Payloads extends unknown[], Ret> = (
  ...args: Payloads
) => Promise<Ret>;
type MutationDefinition<State extends StateTree, Payloads extends unknown[]> = {
  mut(state: State, ...payloads: Payloads): void;
  act(...payloads: Payloads): void;
};
