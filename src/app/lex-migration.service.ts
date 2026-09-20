import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import {
  createFallbackConversationFlowJson,
  createFallbackIntentJson,
  createLambdaRouterSource,
  createLexV2V1ConversionSource
} from './lex-artifact-templates';

export interface LexMigrationArchives {
  botName: string;
  lexZip: Blob;
  lambdaZip: Blob;
}

@Injectable({ providedIn: 'root' })
export class LexMigrationService {
  // Lex V1 and V2 use different names for some built-in slot types. This map
  // keeps those compatibility rules in one place instead of scattering if/else
  // checks throughout the slot conversion loop.
  private readonly lexV1ToV2SlotTypes: Record<string, string> = {
    "AMAZON.NUMBER": "AMAZON.Number",
    "AMAZON.StreetAddress": "AMAZON.StreetName",
    "AMAZON.PostalAddress": "AMAZON.StreetName",
    "AMAZON.GB_FIRST_NAME": "AMAZON.FirstName",
    "AMAZON.US_FIRST_NAME": "AMAZON.FirstName",
    "AMAZON.CreativeWorkType": "AMAZON.FreeFormInput",
    "AMAZON.WrittenCreativeWorkType": "AMAZON.FreeFormInput",
    "AMAZON.MedicalOrganization": "AMAZON.FreeFormInput",
    "AMAZON.MusicVideo": "AMAZON.FreeFormInput",
    "AMAZON.Person": "AMAZON.FirstName",
    "AMAZON.DATE": "AMAZON.Date",
    "AMAZON.TIME": "AMAZON.Time",
    "AMAZON.Service": "AMAZON.FreeFormInput",
    "AMAZON.EducationalOrganization": "AMAZON.FreeFormInput"
  };

  async generateArchives(lexV1FileContent: any, description: string): Promise<LexMigrationArchives> {
    const zip = new JSZip();
    const zipRouter = new JSZip();

    // These values are scoped to a single generation run. Keeping them local
    // prevents stale Lambda mappings from leaking between multiple uploads.
    const intentList: string[] = [];
    const intentLambdaList: Record<string, string | null> = {};
    let fallbackIntentName: string | null = "";

    const botName = lexV1FileContent.resource.name + "_v2";
    const locale = lexV1FileContent.resource.locale.replace('-', '_');
    const basePath = `${botName}/BotLocales/${locale}`;
    const intentsPath = `${basePath}/Intents`;
    const slotTypesPath = `${basePath}/SlotTypes`;

    // Lex import packages require a manifest at the root of the ZIP.
    zip.file('Manifest.json', JSON.stringify({ "metaData": { "schemaVersion": "1", "fileFormat": "LexJson", "resourceType": "BOT" } }, null, 2));

    // Bot-level configuration. Some values are currently fixed defaults and can
    // be expanded later to preserve more source-bot settings.
    const botJson = {
      name: botName,
      description,
      dataPrivacy: { childDirected: false },
      idleSessionTTLInSeconds: 300
    };

    zip.file(`${botName}/Bot.json`, JSON.stringify(botJson, null, 2));
    const localId = locale.split('_')[1];
    zip.file(`${basePath}/BotLocale.json`, JSON.stringify({
      "name": `English (${localId})`,
      "identifier": locale,
      "version": null,
      "description": null,
      "voiceSettings": null,
      "nluConfidenceThreshold": 0.4
    }, null, 2));

    // Convert Lex V1 custom slot types into the Lex V2 SlotType.json structure.
    // Custom names are trimmed because Lex V2 has stricter name length limits.
    const slotTypes = lexV1FileContent.resource.slotTypes;
    if (slotTypes?.length) {
      slotTypes.forEach((slotType: any) => {
        const originalName = slotType.name;
        let trimmedName = originalName;
        if (!originalName.startsWith("AMAZON")) {
          trimmedName = originalName.substring(0, 24);
        }
        const slotTypeJson = {
          name: trimmedName,
          identifier: '',
          description: null,
          slotTypeValues: (slotType.enumerationValues || []).map((v: any) => ({
            sampleValue: { value: v.value },
            synonyms: null
          })),
          parentSlotTypeSignature: null,
          valueSelectionSetting: {
            resolutionStrategy: 'ORIGINAL_VALUE'
          }
        };
        zip.file(`${slotTypesPath}/${trimmedName}/SlotType.json`, JSON.stringify(slotTypeJson, null, 2));
      });
    } else {
      console.warn('[SlotTypes] No slot types found.');
    }

    const intents = lexV1FileContent.resource.intents;
    if (intents?.length) {
      intents.forEach((intent: any) => {
        let fulfillmentCodeHook: any = {};
        let initialResponseSetting: any = {};
        let dialogCodeHook: any = {};
        let intentClosingSetting: any = {};
        let successNextStep: any = {};

        // Capture the fallback Lambda so the generated router has a default
        // target when Lex V2 invokes the fallback intent.
        if (intent.parentIntentSignature == "AMAZON.FallbackIntent") {
          if (intent?.fulfillmentActivity?.codeHook) {
            const arn = intent.fulfillmentActivity.codeHook.uri;
            fallbackIntentName = this.getFunctionNameFromArn(arn);
          }
        }
        if (intent.parentIntentSignature != "AMAZON.FallbackIntent") {
          const intentFolder = `${intentsPath}/${intent.name}`;
          const slotFolder = `${intentFolder}/Slots`;
          let responseCardInlowPrioritySlot = false;

          // Lex V2 expects slot priorities in the intent file while each slot
          // definition lives in its own folder under the intent.
          const slotsPriority = (intent.slots || []).map((s: any) => ({ priority: s.priority, slotName: s.name }));
          let lowestPrioritySlot: any = null;
          if (slotsPriority.length > 0) {
            const lowestPriority = slotsPriority.reduce((min: any, curr: any) => {
              return curr.priority < min.priority ? curr : min;
            });
            lowestPrioritySlot = lowestPriority.slotName;
          }
          if (slotsPriority.length == 1) {
            lowestPrioritySlot = slotsPriority[0].slotName;
          }

          (intent.slots || []).forEach((slot: any) => {
            // If the final slot has a response card, route fulfillment success
            // back to that slot so users still see the button choices.
            if (slot.name == lowestPrioritySlot) {
              if (slot.valueElicitationPrompt?.responseCard) {
                responseCardInlowPrioritySlot = true;
              }
            }
            const originalName = this.normalizeSlotType(slot.slotType);
            let trimmedName = originalName;
            if (!originalName.startsWith("AMAZON")) {
              trimmedName = originalName.substring(0, 24);
            }

            // Slot.json contains the prompt, retry behavior, and slot capture
            // settings Lex V2 needs to elicit this value.
            const slotJson: any = {
              name: slot.name,
              identifier: '',
              description: null,
              slotTypeName: trimmedName,
              obfuscationSetting: { obfuscationSettingType: 'None' },
              valueElicitationSetting: {
                slotCaptureSetting: {
                  codeHook: null,
                  captureResponse: null,
                  captureNextStep: null,
                  captureConditional: null,
                  failureResponse: null,
                  failureNextStep: null,
                  failureConditional: null,
                  elicitationCodeHook: {
                    enableCodeHookInvocation: true,
                    invocationLabel: null
                  }
                },
                slotConstraint: slot.slotConstraint,
                promptSpecification: {
                  messageGroupsList: [
                    {
                      message: {
                        ssmlMessage: null,
                        customPayload: null,
                        plainTextMessage: {
                          value: slot.valueElicitationPrompt?.messages?.[0]?.content || ""
                        },
                        imageResponseCard: null
                      },
                      variations: null
                    }
                  ],
                  maxRetries: 1,
                  allowInterrupt: true,
                  messageSelectionStrategy: 'Random',
                  promptAttemptsSpecification: {
                    Initial: {
                      textInputSpecification: { startTimeoutMs: 30000 },
                      allowedInputTypes: {
                        allowAudioInput: true,
                        allowDTMFInput: true
                      },
                      audioAndDTMFInputSpecification: {
                        startTimeoutMs: 4000,
                        audioSpecification: {
                          endTimeoutMs: 640,
                          maxLengthMs: 15000
                        },
                        dtmfSpecification: {
                          maxLength: 513,
                          endTimeoutMs: 5000,
                          deletionCharacter: '*',
                          endCharacter: '#'
                        }
                      },
                      allowInterrupt: true
                    },
                    Retry1: {
                      textInputSpecification: {
                        startTimeoutMs: 30000
                      },
                      allowedInputTypes: {
                        allowAudioInput: true,
                        allowDTMFInput: true
                      },
                      audioAndDTMFInputSpecification: {
                        startTimeoutMs: 4000,
                        audioSpecification: {
                          endTimeoutMs: 640,
                          maxLengthMs: 15000
                        },
                        dtmfSpecification: {
                          maxLength: 513,
                          endTimeoutMs: 5000,
                          deletionCharacter: "*",
                          endCharacter: "#"
                        }
                      },
                      allowInterrupt: true
                    }
                  }
                },
                defaultValueSpecification: {
                  defaultValueList: []
                },
                sampleUtterances: null,
                waitAndContinueSpecification: null
              },
              multipleValuesSetting: null
            };
            if (responseCardInlowPrioritySlot) {
              slotJson.valueElicitationSetting["slotConstraint"] = "Required";
            }
            else {
              slotJson.valueElicitationSetting["slotConstraint"] = slot.slotConstraint;
            }

            if (slot.valueElicitationPrompt?.responseCard) {
              // Lex V1 response cards are stored as JSON strings. Convert them
              // into Lex V2 image response card message groups.
              const messageList = this.convertButtonResponseCard(slot.valueElicitationPrompt?.responseCard);
              messageList.forEach((msgList: any) => {
                slotJson["valueElicitationSetting"]["promptSpecification"]["messageGroupsList"].push(msgList);
              });
            }

            zip.file(`${slotFolder}/${slot.name}/Slot.json`, JSON.stringify(slotJson, null, 2));
          });

          if (intent.fulfillmentActivity && intent.fulfillmentActivity.type == "CodeHook") {
            // Fulfillment code hooks are preserved by routing the Lex V2 event
            // through the generated Lambda adapter.
            if (responseCardInlowPrioritySlot) {
              successNextStep = {
                "sessionAttributes": null,
                "dialogAction": {
                  "type": "ElicitSlot",
                  "slotToElicit": lowestPrioritySlot,
                  "intentsInScope": null,
                  "suppressNextMessage": null
                },
                "intent": null
              }
            }
            else {
              successNextStep = {
                "sessionAttributes": null,
                "dialogAction": {
                  "type": "FulfillIntent",
                  "slotToElicit": null,
                  "intentsInScope": null,
                  "suppressNextMessage": null
                },
                "intent": null
              }
            }
            initialResponseSetting = {
              "conditional": null,
              "codeHook": {
                "isActive": true,
                "enableCodeHookInvocation": true,
                "invocationLabel": null,
                "postCodeHookSpecification": {
                  "failureResponse": null,
                  "failureNextStep": {
                    "sessionAttributes": null,
                    "dialogAction": {
                      "type": "EndConversation",
                      "slotToElicit": null,
                      "intentsInScope": null,
                      "suppressNextMessage": null
                    },
                    "intent": null
                  },
                  "failureConditional": null,
                  "successResponse": null,
                  "successNextStep": successNextStep,
                  "successConditional": null,
                  "timeoutResponse": null,
                  "timeoutNextStep": {
                    "sessionAttributes": null,
                    "dialogAction": {
                      "type": "EndConversation",
                      "slotToElicit": null,
                      "intentsInScope": null,
                      "suppressNextMessage": null
                    },
                    "intent": null
                  },
                  "timeoutConditional": null
                },
              },
              "nextStep": {
                "sessionAttributes": null,
                "dialogAction": {
                  "type": "InvokeDialogCodeHook",
                  "slotToElicit": null,
                  "intentsInScope": null,
                  "suppressNextMessage": null
                },
                "intent": null
              },
              "initialResponse": null
            };
            fulfillmentCodeHook = {
              postFulfillmentStatusSpecification: {
                failureResponse: null,
                failureNextStep: this.defaultNextStep("EndConversation"),
                successResponse: null,
                successNextStep: this.defaultNextStep("EndConversation"),
                timeoutResponse: null,
                timeoutNextStep: this.defaultNextStep("EndConversation")
              },
              fulfillmentUpdatesSpecification: null,
              enabled: true
            };
            const arn = intent.fulfillmentActivity.codeHook.uri;
            const functionName = this.getFunctionNameFromArn(arn);
            intentLambdaList[intent.name] = functionName;
            intentList.push(intent.name);
          }
          else {
            initialResponseSetting = null;
            fulfillmentCodeHook = null;
          }

          if (intent.dialogCodeHook) {
            // Dialog hooks also require the Lambda router because existing
            // handlers generally expect Lex V1-style request/response payloads.
            dialogCodeHook = {
              enabled: true
            }
            const arn = intent.dialogCodeHook.uri;
            const functionName = this.getFunctionNameFromArn(arn);
            intentLambdaList[intent.name] = functionName;
            intentList.push(intent.name);
          }
          else {
            dialogCodeHook = {
              enabled: false
            }
          }

          if (intent.conclusionStatement) {
            // Closing statements become Lex V2 closing responses. Response card
            // buttons are appended as additional message groups when present.
            intentClosingSetting = {
              isActive: true,
              nextStep: {
                sessionAttributes: null,
                dialogAction: {
                  type: "EndConversation",
                  slotToElicit: null,
                  intentsInScope: null,
                  suppressNextMessage: null
                },
                intent: null
              },
              closingResponse: {
                messageGroupsList: [
                  {
                    message: {
                      ssmlMessage: null,
                      customPayload: null,
                      plainTextMessage: {
                        value: intent.conclusionStatement?.messages?.[0]?.content || ""
                      },
                      imageResponseCard: null
                    },
                    variations: null
                  }
                ],
                allowInterrupt: true
              }
            };

            if (intent.conclusionStatement?.responseCard) {
              const messageList = this.convertButtonResponseCard(intent.conclusionStatement?.responseCard);
              messageList.forEach((msgList: any) => {
                intentClosingSetting["closingResponse"]["messageGroupsList"].push(msgList);
              });
            }

          }
          else {
            intentClosingSetting = null;
          }

          // Intent.json ties together utterances, hooks, closing behavior, and
          // slot priority metadata for this migrated intent.
          const intentJson: any = {
            name: intent.name || '',
            identifier: null,
            description: null,
            parentIntentSignature: null,
            sampleUtterances: (intent.sampleUtterances || []).map((utterance: any) => ({ utterance })),
            intentConfirmationSetting: null,
            intentClosingSetting: intentClosingSetting,
            initialResponseSetting: initialResponseSetting,
            inputContexts: null,
            outputContexts: null,
            kendraConfiguration: null,
            qnAIntentConfiguration: null,
            bedrockAgentIntentConfiguration: null,
            qInConnectIntentConfiguration: null,
            dialogCodeHook: dialogCodeHook,
            fulfillmentCodeHook: fulfillmentCodeHook,
            slotPriorities: intent.slots ? slotsPriority : []
          }

          zip.file(`${intentFolder}/Intent.json`, JSON.stringify(intentJson, null, 2));
        }
      });

      const fallbackFolder = `${intentsPath}/FallbackIntent`;

      // Fallback and Lambda helper artifacts are maintained separately because
      // they are large static templates compared with the per-bot conversion.
      zip.file(`${fallbackFolder}/Intent.json`, JSON.stringify(createFallbackIntentJson(), null, 2));
      zip.file(`${fallbackFolder}/ConversationFlow.json`, JSON.stringify(createFallbackConversationFlowJson(), null, 2));

      zipRouter.file(
        `lambda_function.py`,
        createLambdaRouterSource(intentLambdaList, intentList, fallbackIntentName)
      );
      zipRouter.file(`lex_v2_v1_conversion.py`, createLexV2V1ConversionSource());
    } else {
      console.warn('[Intents] No intents found.');
    }

    // Generate browser blobs so the component can save both ZIP files locally.
    const lexZip = await zip.generateAsync({ type: 'blob' });
    const lambdaZip = await zipRouter.generateAsync({ type: 'blob' });

    return { botName, lexZip, lambdaZip };
  }

  private defaultNextStep(type: any) {
    // Helper for repeated Lex V2 next-step objects.
    return {
      sessionAttributes: null,
      dialogAction: {
        type,
        slotToElicit: null,
        intentsInScope: null,
        suppressNextMessage: null,
      },
      intent: null
    };
  }

  private convertButtonResponseCard(responseCardString: any) {
    try {
      const mussageList: any = [];
      const card = JSON.parse(responseCardString);
      const buttons = card.genericAttachments || [];

      // Lex V2 limits response-card button groups, so cap the generated message
      // groups and buttons to keep the import payload valid.
      buttons.forEach((buttonList: any, index: number) => {
        if (index < 4) {
          const allBtn = buttonList.buttons.slice(0, 5);
          const newMessage: any = {
            message: {
              ssmlMessage: null,
              customPayload: null,
              plainTextMessage: null,
              imageResponseCard: {
                title: "Please select from below buttons:",
                subtitle: null,
                imageUrl: null,
                buttonsList: allBtn || []
              }
            },
            variations: null
          };
          mussageList.push(newMessage);
        }

      });

      return mussageList;
    } catch (err) {
      console.warn("Invalid response card JSON", err);
      return [];
    }
  }

  private normalizeSlotType(slotType: string) {
    return this.lexV1ToV2SlotTypes[slotType] ?? slotType;
  }

  private getFunctionNameFromArn(arn: any) {
    // Lambda mappings only need the function name portion of the ARN.
    const prefix = "function:";
    const index = arn.indexOf(prefix);
    if (index === -1) {
      return null;
    }
    return arn.substring(index + prefix.length);
  }
}
