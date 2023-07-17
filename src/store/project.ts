import semver from "semver";
import { optional, z } from "zod";
import { buildProjectFileName, getBaseName } from "./utility";
import { createPartialStore } from "./vuex";
import { createUILockAction } from "@/store/ui";
import { AudioItem, ProjectStoreState, ProjectStoreTypes } from "@/store/type";

import { AccentPhrase } from "@/openapi";
import {
  AudioKey,
  audioKeySchema,
  EngineId,
  engineIdSchema,
  speakerIdSchema,
  styleIdSchema,
} from "@/type/preload";
import { getValueOrThrow, ResultError } from "@/type/result";

const DEFAULT_SAMPLING_RATE = 24000;

export const projectStoreState: ProjectStoreState = {
  savedLastCommandUnixMillisec: null,
};

export const projectStore = createPartialStore<ProjectStoreTypes>({
  PROJECT_NAME: {
    getter(state) {
      return state.projectFilePath
        ? getBaseName(state.projectFilePath)
        : undefined;
    },
  },

  SET_PROJECT_FILEPATH: {
    mutation(state, { filePath }: { filePath?: string }) {
      state.projectFilePath = filePath;
    },
  },

  CREATE_NEW_PROJECT: {
    action: createUILockAction(
      async (context, { confirm }: { confirm?: boolean }) => {
        if (confirm !== false && context.getters.IS_EDITED) {
          const result = await context.dispatch(
            "SAVE_OR_DISCARD_PROJECT_FILE",
            {}
          );
          if (result == "canceled") {
            return;
          }
        }

        await context.dispatch("REMOVE_ALL_AUDIO_ITEM");

        const audioItem: AudioItem = await context.dispatch(
          "GENERATE_AUDIO_ITEM",
          {}
        );
        await context.dispatch("REGISTER_AUDIO_ITEM", {
          audioItem,
        });

        context.commit("SET_PROJECT_FILEPATH", { filePath: undefined });
        context.commit("SET_SAVED_LAST_COMMAND_UNIX_MILLISEC", null);
        context.commit("CLEAR_COMMANDS");
      }
    ),
  },

  LOAD_PROJECT_FILE: {
    /**
     * プロジェクトファイルを読み込む。読み込めたかの成否が返る。
     * エラー発生時はダイアログが表示される。
     */
    action: createUILockAction(
      async (
        context,
        { filePath, confirm }: { filePath?: string; confirm?: boolean }
      ) => {
        if (!filePath) {
          // Select and load a project File.
          const ret = await window.electron.showProjectLoadDialog({
            title: "プロジェクトファイルの選択",
          });
          if (ret == undefined || ret?.length == 0) {
            return false;
          }
          filePath = ret[0];
        }

        const projectFileErrorMsg = `VOICEVOX Project file "${filePath}" is a invalid file.`;

        let buf: ArrayBuffer;
        try {
          buf = await window.electron
            .readFile({ filePath })
            .then(getValueOrThrow);

          await context.dispatch("APPEND_RECENTLY_USED_PROJECT", {
            filePath,
          });
          const text = new TextDecoder("utf-8").decode(buf).trim();
          const projectData = JSON.parse(text);

          // appVersion Validation check
          if (
            !(
              "appVersion" in projectData &&
              typeof projectData.appVersion === "string"
            )
          ) {
            throw new Error(
              projectFileErrorMsg +
                " The appVersion of the project file should be string"
            );
          }
          const projectAppVersion: string = projectData.appVersion;
          if (!semver.valid(projectAppVersion)) {
            throw new Error(
              projectFileErrorMsg +
                ` The app version of the project file "${projectAppVersion}" is invalid. The app version should be a string in semver format.`
            );
          }

          const semverSatisfiesOptions: semver.Options = {
            includePrerelease: true,
          };

          // Migration
          const engineId = EngineId("074fc39e-678b-4c13-8916-ffca8d505d1d");

          const v_0_3_0_MoraSchema = z.object({
            text: z.string(),
            vowel: z.string(),
            pitch: z.number(),
            consonant: z.string().optional(),
          });
          const v_0_3_0_AccentPhraseSchema = z.object({
            moras: z.array(v_0_3_0_MoraSchema),
            accent: z.number(),
            pauseMora: v_0_3_0_MoraSchema.optional(),
          });
          const v_0_3_0_AudioQuerySchema = z.object({
            accentPhrases: z.array(v_0_3_0_AccentPhraseSchema),
            speedScale: z.number(),
            pitchScale: z.number(),
            intonationScale: z.number(),
          });
          const v_0_3_0_AudioItemSchema = z.object({
            text: z.string(),
            charactorIndex: z.number().optional(),
            query: v_0_3_0_AudioQuerySchema.optional(),
          });
          const v_0_4_0_AudioItemSchema = v_0_3_0_AudioItemSchema
            .omit({ charactorIndex: true })
            .extend(z.object({}));

          if (
            semver.satisfies(projectAppVersion, "<0.4", semverSatisfiesOptions)
          ) {
            for (const audioItemsKey in projectData.audioItems) {
              if ("charactorIndex" in projectData.audioItems[audioItemsKey]) {
                projectData.audioItems[audioItemsKey].characterIndex =
                  projectData.audioItems[audioItemsKey].charactorIndex;
                delete projectData.audioItems[audioItemsKey].charactorIndex;
              }
            }
            for (const audioItemsKey in projectData.audioItems) {
              if (projectData.audioItems[audioItemsKey].query != null) {
                projectData.audioItems[audioItemsKey].query.volumeScale = 1;
                projectData.audioItems[
                  audioItemsKey
                ].query.prePhonemeLength = 0.1;
                projectData.audioItems[
                  audioItemsKey
                ].query.postPhonemeLength = 0.1;
                projectData.audioItems[audioItemsKey].query.outputSamplingRate =
                  DEFAULT_SAMPLING_RATE;
              }
            }
          }

          if (
            semver.satisfies(projectAppVersion, "<0.5", semverSatisfiesOptions)
          ) {
            for (const audioItemsKey in projectData.audioItems) {
              const audioItem = projectData.audioItems[audioItemsKey];
              if (audioItem.query != null) {
                audioItem.query.outputStereo = false;
                for (const accentPhrase of audioItem.query.accentPhrases) {
                  if (accentPhrase.pauseMora) {
                    accentPhrase.pauseMora.vowelLength = 0;
                  }
                  for (const mora of accentPhrase.moras) {
                    if (mora.consonant) {
                      mora.consonantLength = 0;
                    }
                    mora.vowelLength = 0;
                  }
                }

                // set phoneme length
                // 0.7 未満のプロジェクトファイルは styleId ではなく characterIndex なので、ここだけ characterIndex とした
                if (audioItem.characterIndex === undefined)
                  throw new Error("audioItem.characterIndex === undefined");
                await context
                  .dispatch("FETCH_MORA_DATA", {
                    accentPhrases: audioItem.query.accentPhrases,
                    engineId,
                    styleId: audioItem.characterIndex,
                  })
                  .then((accentPhrases: AccentPhrase[]) => {
                    accentPhrases.forEach((newAccentPhrase, i) => {
                      const oldAccentPhrase = audioItem.query.accentPhrases[i];
                      if (newAccentPhrase.pauseMora) {
                        oldAccentPhrase.pauseMora.vowelLength =
                          newAccentPhrase.pauseMora.vowelLength;
                      }
                      newAccentPhrase.moras.forEach((mora, j) => {
                        if (mora.consonant) {
                          oldAccentPhrase.moras[j].consonantLength =
                            mora.consonantLength;
                        }
                        oldAccentPhrase.moras[j].vowelLength = mora.vowelLength;
                      });
                    });
                  });
              }
            }
          }

          if (
            semver.satisfies(projectAppVersion, "<0.7", semverSatisfiesOptions)
          ) {
            for (const audioItemsKey in projectData.audioItems) {
              const audioItem = projectData.audioItems[audioItemsKey];
              if (audioItem.characterIndex != null) {
                if (audioItem.characterIndex == 0) {
                  // 四国めたん 0 -> 四国めたん(あまあま) 0
                  audioItem.speaker = 0;
                }
                if (audioItem.characterIndex == 1) {
                  // ずんだもん 1 -> ずんだもん(あまあま) 1
                  audioItem.speaker = 1;
                }
                delete audioItem.characterIndex;
              }
            }
          }

          if (
            semver.satisfies(projectAppVersion, "<0.8", semverSatisfiesOptions)
          ) {
            for (const audioItemsKey in projectData.audioItems) {
              const audioItem = projectData.audioItems[audioItemsKey];
              if (audioItem.speaker !== null) {
                audioItem.styleId = audioItem.speaker;
                delete audioItem.speaker;
              }
            }
          }

          if (
            semver.satisfies(projectAppVersion, "<0.14", semverSatisfiesOptions)
          ) {
            for (const audioItemsKey in projectData.audioItems) {
              const audioItem = projectData.audioItems[audioItemsKey];
              if (audioItem.engineId === undefined) {
                audioItem.engineId = engineId;
              }
            }
          }

          if (
            semver.satisfies(projectAppVersion, "<0.15", semverSatisfiesOptions)
          ) {
            const characterInfos = context.getters.USER_ORDERED_CHARACTER_INFOS;
            if (characterInfos == undefined)
              throw new Error("USER_ORDERED_CHARACTER_INFOS == undefined");
            for (const audioItemsKey in projectData.audioItems) {
              const audioItem = projectData.audioItems[audioItemsKey];
              if (audioItem.voice == undefined) {
                const oldEngineId = audioItem.engineId;
                const oldStyleId = audioItem.styleId;
                const chracterinfo = characterInfos.find((characterInfo) =>
                  characterInfo.metas.styles.some(
                    (styeleinfo) =>
                      styeleinfo.engineId === audioItem.engineId &&
                      styeleinfo.styleId === audioItem.styleId
                  )
                );
                if (chracterinfo == undefined)
                  throw new Error(
                    `chracterinfo == undefined: ${oldEngineId}, ${oldStyleId}`
                  );
                const speakerId = chracterinfo.metas.speakerUuid;
                audioItem.voice = {
                  engineId: oldEngineId,
                  speakerId,
                  styleId: oldStyleId,
                };

                delete audioItem.engineId;
                delete audioItem.styleId;
              }
            }
          }

          // Validation check
          const parsedProjectData = projectSchema.parse(projectData);
          if (
            !parsedProjectData.audioKeys.every(
              (audioKey) => audioKey in parsedProjectData.audioItems
            )
          ) {
            throw new Error(
              projectFileErrorMsg +
                " Every audioKey in audioKeys should be a key of audioItems"
            );
          }
          if (
            !parsedProjectData.audioKeys.every(
              (audioKey) =>
                parsedProjectData.audioItems[audioKey]?.voice != undefined
            )
          ) {
            throw new Error('Every audioItem should have a "voice" attribute.');
          }
          if (
            !parsedProjectData.audioKeys.every(
              (audioKey) =>
                parsedProjectData.audioItems[audioKey]?.voice.engineId !=
                undefined
            )
          ) {
            throw new Error('Every voice should have a "engineId" attribute.');
          }
          // FIXME: assert engineId is registered
          if (
            !parsedProjectData.audioKeys.every(
              (audioKey) =>
                parsedProjectData.audioItems[audioKey]?.voice.speakerId !=
                undefined
            )
          ) {
            throw new Error('Every voice should have a "speakerId" attribute.');
          }
          if (
            !parsedProjectData.audioKeys.every(
              (audioKey) =>
                parsedProjectData.audioItems[audioKey]?.voice.styleId !=
                undefined
            )
          ) {
            throw new Error('Every voice should have a "styleId" attribute.');
          }

          if (confirm !== false && context.getters.IS_EDITED) {
            const result = await context.dispatch(
              "SAVE_OR_DISCARD_PROJECT_FILE",
              {
                additionalMessage:
                  "プロジェクトをロードすると現在のプロジェクトは破棄されます。",
              }
            );
            if (result == "canceled") {
              return false;
            }
          }
          await context.dispatch("REMOVE_ALL_AUDIO_ITEM");

          const { audioItems, audioKeys } = projectData as ProjectType;

          let prevAudioKey = undefined;
          for (const audioKey of audioKeys) {
            const audioItem = audioItems[audioKey];
            prevAudioKey = await context.dispatch("REGISTER_AUDIO_ITEM", {
              prevAudioKey,
              audioItem,
            });
          }
          context.commit("SET_PROJECT_FILEPATH", { filePath });
          context.commit("SET_SAVED_LAST_COMMAND_UNIX_MILLISEC", null);
          context.commit("CLEAR_COMMANDS");
          return true;
        } catch (err) {
          window.electron.logError(err);
          const message = (() => {
            if (typeof err === "string") return err;
            if (!(err instanceof Error)) return "エラーが発生しました。";
            if (err instanceof ResultError && err.code === "ENOENT")
              return "プロジェクトファイルが見つかりませんでした。ファイルが移動、または削除された可能性があります。";
            if (err.message.startsWith(projectFileErrorMsg))
              return "ファイルフォーマットが正しくありません。";
            return err.message;
          })();
          await window.electron.showMessageDialog({
            type: "error",
            title: "エラー",
            message: `プロジェクトファイルの読み込みに失敗しました。\n${message}`,
          });
          return false;
        }
      }
    ),
  },

  SAVE_PROJECT_FILE: {
    /**
     * プロジェクトファイルを保存する。保存の成否が返る。
     * エラー発生時はダイアログが表示される。
     */
    action: createUILockAction(
      async (context, { overwrite }: { overwrite?: boolean }) => {
        let filePath = context.state.projectFilePath;
        try {
          if (!overwrite || !filePath) {
            let defaultPath: string;

            if (!filePath) {
              // if new project: use generated name
              defaultPath = buildProjectFileName(context.state, "vvproj");
            } else {
              // if saveAs for existing project: use current project path
              defaultPath = filePath;
            }

            // Write the current status to a project file.
            const ret = await window.electron.showProjectSaveDialog({
              title: "プロジェクトファイルの保存",
              defaultPath,
            });
            if (ret == undefined) {
              return false;
            }
            filePath = ret;
          }
          if (
            context.state.projectFilePath &&
            context.state.projectFilePath != filePath
          ) {
            await window.electron.showMessageDialog({
              type: "info",
              title: "保存",
              message: `編集中のプロジェクトが ${filePath} に切り替わりました。`,
            });
          }

          await context.dispatch("APPEND_RECENTLY_USED_PROJECT", {
            filePath,
          });
          const appInfos = await window.electron.getAppInfos();
          const { audioItems, audioKeys } = context.state;
          const projectData: ProjectType = {
            appVersion: appInfos.version,
            audioKeys,
            audioItems,
          };
          const buf = new TextEncoder().encode(
            JSON.stringify(projectData)
          ).buffer;
          await window.electron
            .writeFile({
              filePath,
              buffer: buf,
            })
            .then(getValueOrThrow);
          context.commit("SET_PROJECT_FILEPATH", { filePath });
          context.commit(
            "SET_SAVED_LAST_COMMAND_UNIX_MILLISEC",
            context.getters.LAST_COMMAND_UNIX_MILLISEC
          );
          return true;
        } catch (err) {
          window.electron.logError(err);
          const message = (() => {
            if (typeof err === "string") return err;
            if (!(err instanceof Error)) return "エラーが発生しました。";
            return err.message;
          })();
          await window.electron.showMessageDialog({
            type: "error",
            title: "エラー",
            message: `プロジェクトファイルの保存に失敗しました。\n${message}`,
          });
          return false;
        }
      }
    ),
  },

  /**
   * プロジェクトファイルを保存するか破棄するかキャンセルするかのダイアログを出して、保存する場合は保存する。
   * 何を選択したかが返る。
   * 保存に失敗した場合はキャンセル扱いになる。
   */
  SAVE_OR_DISCARD_PROJECT_FILE: {
    action: createUILockAction(async ({ dispatch }, { additionalMessage }) => {
      let message = "プロジェクトの変更が保存されていません。";
      if (additionalMessage) {
        message += "\n" + additionalMessage;
      }
      message += "\n変更を保存しますか？";

      const result: number = await window.electron.showQuestionDialog({
        type: "info",
        title: "警告",
        message,
        buttons: ["保存", "破棄", "キャンセル"],
        cancelId: 2,
        defaultId: 2,
      });
      if (result == 0) {
        const saved = await dispatch("SAVE_PROJECT_FILE", {
          overwrite: true,
        });
        return saved ? "saved" : "canceled";
      } else if (result == 1) {
        return "discarded";
      } else {
        return "canceled";
      }
    }),
  },

  IS_EDITED: {
    getter(state, getters) {
      return (
        getters.LAST_COMMAND_UNIX_MILLISEC !==
        state.savedLastCommandUnixMillisec
      );
    },
  },

  SET_SAVED_LAST_COMMAND_UNIX_MILLISEC: {
    mutation(state, unixMillisec) {
      state.savedLastCommandUnixMillisec = unixMillisec;
    },
  },
});

namespace ProjectSchemaMigration {
  namespace RootSchema {
    export const moraSchema = z.object({
      text: z.string(),
      vowel: z.string(),
      pitch: z.number(),
      consonant: z.string().optional(),
    });
    export const accentPhraseSchema = z.object({
      moras: z.array(moraSchema),
      accent: z.number(),
      pauseMora: moraSchema.optional(),
    });
    export const audioQuerySchema = z.object({
      accentPhrases: z.array(accentPhraseSchema),
      speedScale: z.number(),
      pitchScale: z.number(),
      intonationScale: z.number(),
    });
    export const audioItemSchema = z.object({
      text: z.string(),
      charactorIndex: z.number().optional(),
      query: audioQuerySchema.optional(),
    });
  }
  namespace v_0_3_0 {
    export const moraSchema = RootSchema.moraSchema;
    export const accentPhraseSchema = RootSchema.accentPhraseSchema;
    export const audioQuerySchema = RootSchema.audioQuerySchema;
    export const audioItemSchema = RootSchema.audioItemSchema;
  }
  namespace v_0_4_0 {
    export const moraSchema = v_0_3_0.moraSchema;
    export const accentPhraseSchema = v_0_3_0.accentPhraseSchema;
    export const audioQuerySchema = v_0_3_0.audioQuerySchema.extend({
      volumeScale: z.number(),
      prePhonemeLength: z.number(),
      postPhonemeLength: z.number(),
      outputSamplingRate: z.number(),
    });
    export const audioItemSchema = v_0_3_0.audioItemSchema
      .omit({
        query: true,
        charactorIndex: true,
      })
      .extend({
        characterIndex: z.number().optional(),
        query: audioQuerySchema.optional(),
      });
  }
  namespace v_0_5_0 {
    export const moraSchema = v_0_4_0.moraSchema.extend({
      vowelLength: z.number(),
      consonantLength: z.number().optional(),
    });
    export const accentPhraseSchema = v_0_4_0.accentPhraseSchema
      .omit({
        moras: true,
        pauseMora: true,
      })
      .extend({ moras: z.array(moraSchema), pauseMora: moraSchema.optional() });
    export const audioQuerySchema = v_0_4_0.audioQuerySchema
      .omit({
        accentPhrases: true,
      })
      .extend({
        accentPhrases: z.array(accentPhraseSchema),
        outputStereo: z.boolean(),
      });
    export const audioItemSchema = v_0_4_0.audioItemSchema
      .omit({
        query: true,
      })
      .extend({ query: audioQuerySchema.optional() });
  }
  namespace v_0_6_0 {
    export const moraSchema = v_0_5_0.moraSchema;
    export const accentPhraseSchema = v_0_5_0.accentPhraseSchema;
    export const audioQuerySchema = v_0_5_0.audioQuerySchema.extend({
      kana: z.string().optional(),
    });
    export const audioItemSchema = v_0_5_0.audioItemSchema
      .omit({
        query: true,
      })
      .extend({
        query: audioQuerySchema.optional(),
      });
  }
  namespace v_0_7_0 {
    export const moraSchema = v_0_6_0.moraSchema;
    export const accentPhraseSchema = v_0_6_0.accentPhraseSchema;
    export const audioQuerySchema = v_0_6_0.audioQuerySchema;
    export const audioItemSchema = v_0_6_0.audioItemSchema
      .omit({
        characterIndex: true,
      })
      .extend({
        speaker: z.number().optional(),
      });
  }
  namespace v_0_8_0 {
    export const moraSchema = v_0_7_0.moraSchema;
    export const accentPhraseSchema = v_0_7_0.accentPhraseSchema;
    export const audioQuerySchema = v_0_7_0.audioQuerySchema;
    export const audioItemSchema = v_0_7_0.audioItemSchema
      .omit({
        speaker: true,
      })
      .extend({
        styleId: z.number().optional(),
      });
  }

  namespace v_0_10_0 {
    export const moraSchema = v_0_8_0.moraSchema;
    export const accentPhraseSchema = v_0_8_0.accentPhraseSchema;
    export const audioQuerySchema = v_0_8_0.audioQuerySchema;
    export const audioItemSchema = v_0_8_0.audioItemSchema.extend({
      presetKey: z.string().optional(),
    });
  }

  namespace v_0_14_0 {
    export const moraSchema = v_0_10_0.moraSchema;
    export const accentPhraseSchema = v_0_10_0.accentPhraseSchema;
    export const audioQuerySchema = v_0_10_0.audioQuerySchema;
    export const morphingInfoSchema = z.object({
      rate: z.number(),
      targetEngineId: z.string(),
      targetSpeakerId: z.string(),
      targetStyleId: z.number(),
    });
    export const audioItemSchema = v_0_10_0.audioItemSchema.extend({
      engineId: z.string().optional(),
      morphingInfo: morphingInfoSchema.optional(),
    });
  }
}

const moraSchema = z.object({
  text: z.string(),
  vowel: z.string(),
  vowelLength: z.number(),
  pitch: z.number(),
  consonant: z.string().optional(),
  consonantLength: z.number().optional(),
});

const accentPhraseSchema = z.object({
  moras: z.array(moraSchema),
  accent: z.number(),
  pauseMora: moraSchema.optional(),
  isInterrogative: z.boolean().optional(),
});

const audioQuerySchema = z.object({
  accentPhrases: z.array(accentPhraseSchema),
  speedScale: z.number(),
  pitchScale: z.number(),
  intonationScale: z.number(),
  volumeScale: z.number(),
  prePhonemeLength: z.number(),
  postPhonemeLength: z.number(),
  outputSamplingRate: z.number(),
  outputStereo: z.boolean(),
  kana: z.string().optional(),
});

const morphingInfoSchema = z.object({
  rate: z.number(),
  targetEngineId: engineIdSchema,
  targetSpeakerId: speakerIdSchema,
  targetStyleId: styleIdSchema,
});

const audioItemSchema = z.object({
  text: z.string(),
  voice: z.object({
    engineId: engineIdSchema,
    speakerId: speakerIdSchema,
    styleId: styleIdSchema,
  }),
  query: audioQuerySchema.optional(),
  presetKey: z.string().optional(),
  morphingInfo: morphingInfoSchema.optional(),
});

const projectSchema = z.object({
  appVersion: z.string(),
  // description: "Attribute keys of audioItems.",
  audioKeys: z.array(audioKeySchema),
  // description: "VOICEVOX states per cell",
  audioItems: z.record(audioKeySchema, audioItemSchema),
});

export type LatestProjectType = z.infer<typeof projectSchema>;
interface ProjectType {
  appVersion: string;
  audioKeys: AudioKey[];
  audioItems: Record<AudioKey, AudioItem>;
}
