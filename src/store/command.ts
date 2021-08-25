import {
  enablePatches,
  enableMapSet,
  setUseProxies,
  Patch,
  Draft,
  Immer,
} from "immer";
enablePatches();
enableMapSet();

const immer = new Immer();
immer.setAutoFreeze(false);

import { Store, Payload, ActionContext, StoreOptions } from "vuex";

import { applyPatch, Operation } from "rfc6902";
import { State } from "./type";

export const CAN_UNDO = "CAN_UNDO";
export const CAN_REDO = "CAN_REDO";
export const CLEAR_COMMANDS = "CLEAR_COMMANDS";
export const UNDO = "UNDO";
export const REDO = "REDO";

export const commandStore = {
  getters: {
    [CAN_UNDO](state) {
      return state.undoCommands.length > 0;
    },
    [CAN_REDO](state) {
      return state.redoCommands.length > 0;
    },
  },

  mutations: {
    [UNDO](state) {
      const command = state.undoCommands.pop();
      if (command != null) {
        state.redoCommands.push(command);
        if (command != null) {
          applyPatch(state, command.undoOperation);
        }
      }
    },
    [REDO](state) {
      const command = state.redoCommands.pop();
      if (command != null) {
        state.undoCommands.push(command);
        if (command != null) {
          applyPatch(state, command.doOperation);
        }
      }
    },
    [CLEAR_COMMANDS](state) {
      state.redoCommands.splice(0);
      state.undoCommands.splice(0);
    },
  },

  actions: {
    [UNDO]({ commit }) {
      commit(UNDO);
    },
    [REDO]({ commit }) {
      commit(REDO);
    },
  },
} as StoreOptions<State>;

export type PayloadRecipe<S, P extends Record<string, unknown> | undefined> = (
  draft: Draft<S>,
  payload: P
) => void;
export type PayloadRecipeTree<S> = Record<string, PayloadRecipe<S, any>>;
export type PayloadMutation<S, P extends Record<string, unknown> | undefined> =
  (state: S, payload: P) => void;
export type PayloadMutationTree<S> = Record<string, PayloadMutation<S, any>>;
export type PayloadAction<S, P extends Record<string, unknown> | undefined> = (
  this: Store<S>,
  injectee: ActionContext<S, S>,
  payload: P
) => unknown;
export type PayloadActionTree<S> = Record<string, PayloadAction<S, any>>;

export type Command = {
  doOperation: Operation[];
  undoOperation: Operation[];
};

interface UndoRedoState {
  undoCommands: Command[];
  redoCommands: Command[];
}

type CreatePayloadActionTree<
  S extends UndoRedoState,
  Arg extends PayloadMutationTree<S>
> = {
  [K in keyof Arg]: Arg[K] extends PayloadMutation<S, infer P>
    ? PayloadAction<S, P>
    : PayloadAction<S, undefined>;
};
export const createPayloadActionTree = <
  S extends UndoRedoState,
  Arg extends PayloadMutationTree<S>
>(
  commandMutationTree: Arg
): CreatePayloadActionTree<S, Arg> =>
  Object.fromEntries(
    Object.entries(commandMutationTree).map(([key, commandMutation]) => [
      key,
      createPayloadAction(key, commandMutation),
    ])
  ) as CreatePayloadActionTree<S, Arg>;

export const createPayloadAction =
  <
    S extends UndoRedoState,
    K extends string,
    P extends Record<string, unknown> | undefined
  >(
    mutationType: K,
    _commandMutation: PayloadMutation<S, P>
  ): PayloadAction<S, P> =>
  (injectee: ActionContext<S, S>, payload: P): void => {
    injectee.commit({ ...payload, type: mutationType });
  };

type CreatePayloadMutationTree<
  S extends UndoRedoState,
  Arg extends PayloadRecipeTree<S>
> = {
  [K in keyof Arg]: Arg[K] extends PayloadRecipe<S, infer P>
    ? PayloadMutation<S, P>
    : PayloadMutation<S, undefined>;
};
export const createCommandMutationTree = <
  S extends UndoRedoState,
  Arg extends PayloadRecipeTree<S>
>(
  payloadRecipeTree: Arg
): CreatePayloadMutationTree<S, Arg> =>
  Object.fromEntries(
    Object.entries(payloadRecipeTree).map(([key, val]) => [
      key,
      createCommandMutation(val),
    ])
  ) as CreatePayloadMutationTree<S, Arg>;

export const createCommandMutation =
  <S extends UndoRedoState, P extends Record<string, unknown> | undefined>(
    payloadRecipe: PayloadRecipe<S, P>
  ): PayloadMutation<S, P> =>
  (state: S, payload: P): void => {
    const command = recordOperations(payloadRecipe)(state, payload);
    applyPatch(state, command.doOperation);
    state.undoCommands.push(command);
    state.redoCommands.splice(0);
  };

const patchToOperation = (patch: Patch): Operation => ({
  op: patch.op,
  path: `/${patch.path.join("/")}`,
  value: patch.value,
});

const recordOperations =
  <S, P extends Record<string, unknown> | undefined>(
    recipe: PayloadRecipe<S, P>
  ) =>
  (state: S, payload: P): Command => {
    const [_, doPatches, undoPatches] = immer.produceWithPatches(
      state,
      (draft: Draft<S>) => recipe(draft, payload)
    );
    return {
      doOperation: doPatches.map(patchToOperation),
      undoOperation: undoPatches.map(patchToOperation),
    };
  };
