// Static artifact factories live here to keep the migration service focused on
// transforming the uploaded bot, not maintaining large JSON/Python templates.

export function createFallbackIntentJson() {
  // Lex V2 import packages need an explicit fallback intent definition.
  return {
    "name": "FallbackIntent",
    "identifier": "FALLBCKINT",
    "description": "Default intent when no other intent matches",
    "parentIntentSignature": "AMAZON.FallbackIntent",
    "sampleUtterances": null,
    "intentConfirmationSetting": null,
    "intentClosingSetting": null,
    "initialResponseSetting": null,
    "inputContexts": null,
    "outputContexts": null,
    "kendraConfiguration": null,
    "qnAIntentConfiguration": null,
    "bedrockAgentIntentConfiguration": null,
    "qInConnectIntentConfiguration": null,
    "dialogCodeHook": {
      "enabled": false
    },
    "fulfillmentCodeHook": {
      "isActive": true,
      "postFulfillmentStatusSpecification": {
        "failureResponse": null,
        "failureNextStep": endConversationNextStep(),
        "successResponse": null,
        "successNextStep": endConversationNextStep(),
        "timeoutResponse": null,
        "timeoutNextStep": endConversationNextStep()
      },
      "fulfillmentUpdatesSpecification": null,
      "enabled": true
    },
    "slotPriorities": []
  };
}

export function createFallbackConversationFlowJson() {
  // ConversationFlow.json controls how the Lex V2 console visualizes fallback
  // flow between start, fulfillment, and end blocks.
  return {
    "intentName": "FallbackIntent",
    "identifier": "",
    "conversationFlowData": {
      "blocks": [
        {
          "blockType": "StartIntent",
          "dataLocations": [
            "intent/StartIntent_"
          ],
          "blockId": "startintent",
          "coordinate": {
            "x": "200",
            "y": "400"
          }
        },
        {
          "blockType": "Fulfillment",
          "dataLocations": [
            "intent/Fulfillment_"
          ],
          "blockId": "fulfillment",
          "coordinate": {
            "x": "525",
            "y": "400"
          }
        },
        {
          "blockType": "End",
          "dataLocations": [
            "intent/Fulfillment_/End_FulfillmentSuccess",
            "intent/Fulfillment_/End_FulfillmentError",
            "intent/Fulfillment_/End_FulfillmentTimeout"
          ],
          "blockId": "end",
          "coordinate": {
            "x": "850",
            "y": "400"
          }
        },
        {
          "blockType": "CodeHook",
          "dataLocations": [
            "intent/StartIntent_/CodeHook_InitialResponse"
          ],
          "blockId": "codehook_startintent_InitialResponse",
          "coordinate": {
            "x": "200",
            "y": "700"
          }
        }
      ],
      "metadata": {
        "schemaVersion": "1",
        "dataFormat": "JSON"
      },
      "edges": [
        {
          "vertices": [
            { "x": "780", "y": "560" },
            { "x": "780", "y": "490" },
            { "x": "780", "y": "420" },
            { "x": "780", "y": "417" },
            { "x": "835", "y": "417" }
          ],
          "edgeLocation": "intent/Fulfillment_/End_FulfillmentSuccess",
          "originBlockId": "fulfillment",
          "destinationBlockId": "end",
          "originBlockPort": "FulfillmentSuccess",
          "destinationBlockPort": "EndConversationInput"
        },
        {
          "vertices": [
            { "x": "780", "y": "600" },
            { "x": "780", "y": "530" },
            { "x": "780", "y": "460" },
            { "x": "780", "y": "417" },
            { "x": "835", "y": "417" }
          ],
          "edgeLocation": "intent/Fulfillment_/End_FulfillmentError",
          "originBlockId": "fulfillment",
          "destinationBlockId": "end",
          "originBlockPort": "FulfillmentError",
          "destinationBlockPort": "EndConversationInput"
        },
        {
          "vertices": [
            { "x": "780", "y": "640" },
            { "x": "780", "y": "570" },
            { "x": "780", "y": "500" },
            { "x": "780", "y": "430" },
            { "x": "780", "y": "417" },
            { "x": "835", "y": "417" }
          ],
          "edgeLocation": "intent/Fulfillment_/End_FulfillmentTimeout",
          "originBlockId": "fulfillment",
          "destinationBlockId": "end",
          "originBlockPort": "FulfillmentTimeout",
          "destinationBlockPort": "EndConversationInput"
        }
      ]
    }
  };
}

export function createLambdaRouterSource(
  intentLambdaList: Record<string, unknown>,
  intentList: unknown[],
  fallbackIntentName: string | null
) {
  // The generated router lets migrated Lex V2 bots continue invoking existing
  // Lex V1 Lambda handlers by converting request and response payloads.
  return `
      import json
      import boto3
      from lex_v2_v1_conversion import convert_v1_to_v2_response, convert_v2_to_v1_input
      lambda_client = boto3.client('lambda')

      # Mapping of intents to corresponding Lambda functions
      INTENT_LAMBDA_MAPPING = ${JSON.stringify(intentLambdaList)}

      # Intents requiring V2 to V1 conversion
      V2_V1_CONVERSION_INTENTS = ${JSON.stringify(intentList)}
      def lambda_handler(event, context):
          try:
              print("Lex V2 Event:", json.dumps(event))

              intent_name = event.get("sessionState", {}).get("intent", {}).get("name", "FallbackIntent")
              print("Intent Name:", intent_name)
              target_lambda = INTENT_LAMBDA_MAPPING.get(intent_name, ${JSON.stringify(fallbackIntentName)})
              print("Target Lambda:", target_lambda)
              original_event = event
              if intent_name in V2_V1_CONVERSION_INTENTS:
                  event = convert_v2_to_v1_input(event)
              print("Converted Event:", json.dumps(event))
              lambda_response = lambda_client.invoke(
                  FunctionName=target_lambda,
                  InvocationType='RequestResponse',
                  Payload=json.dumps(event)
              )

              response_payload = json.loads(lambda_response["Payload"].read())
              print("Lambda Response:", json.dumps(response_payload))
              if intent_name in V2_V1_CONVERSION_INTENTS:
                  response_payload = convert_v1_to_v2_response(response_payload, original_event)
              print("Converted Response:", json.dumps(response_payload))
              return response_payload

          except Exception as e:
              print(f"Error during Lambda invocation: {e}")
              return {
                  "sessionState": {
                      "dialogAction": {"type": "Close"},
                      "intent": {"state": "Failed"}
                  },
                  "messages": [{
                      "contentType": "PlainText",
                      "content": f"Error: {str(e)}"
                  }]
              }`;
}

export function createLexV2V1ConversionSource() {
  // Helper Python bundled with the router Lambda. It converts Lex V2 events to
  // Lex V1-style events before invocation, then maps V1 responses back to V2.
  return `def convert_v2_to_v1_input(event):
    # Initialize basic V1 structure
    print("before conversion :",event)
    slot_now = event.get("transcriptions", [{}])[0].get("resolvedSlots", {})
    slot_mark = ""
    if slot_now:
        slot_mark = next(iter(slot_now))

    v1_event = {
        "currentIntent": {
            "name": event.get("sessionState", {}).get("intent", {}).get("name", ""),
            "slots": {},
            "confirmationStatus": "None"
        },
        "bot": {
            "name": event.get("bot", {}).get("name", ""),
            "alias": event.get("bot", {}).get("aliasId", ""),
            "version": "$LATEST"
        },
        "userId": event.get("sessionId", "user"),
        "inputTranscript": event.get("inputTranscript", ""),
        "invocationSource": "DialogCodeHook",  # Default
        "outputDialogMode": "Text",  # Default
        "slotToElicit": slot_mark,
        "sessionAttributes": {},
        "requestAttributes": None
    }
    
    # Map session attributes
    if "sessionState" in event and "sessionAttributes" in event["sessionState"]:
        v1_event["sessionAttributes"] = event["sessionState"]["sessionAttributes"] or {}
    
    # Map request attributes if present
    if "requestAttributes" in event:
        v1_event["requestAttributes"] = event["requestAttributes"]
    
    # Map invocation source
    if "invocationSource" in event:
        if event["invocationSource"] == "DialogCodeHook":
            v1_event["invocationSource"] = "DialogCodeHook"
        else:
            v1_event["invocationSource"] = "FulfillmentCodeHook"
    
    # Map intent confirmation status
    if "sessionState" in event and "intent" in event["sessionState"]:
        intent_state = event["sessionState"]["intent"].get("confirmationState", "")
        if intent_state == "Confirmed":
            v1_event["currentIntent"]["confirmationStatus"] = "Confirmed"
        elif intent_state == "Denied":
            v1_event["currentIntent"]["confirmationStatus"] = "Denied"
        else:
            v1_event["currentIntent"]["confirmationStatus"] = "None"
    
    # Map slots
    if "sessionState" in event and "intent" in event["sessionState"] and "slots" in event["sessionState"]["intent"]:
        slots = event["sessionState"]["intent"]["slots"]
        if slots:
            for slot_name, slot_value in slots.items():
                # In Lex V2, slot values are nested objects
                if slot_value is not None:
                    v1_event["currentIntent"]["slots"][slot_name] = slot_value.get("value", {}).get("interpretedValue") if isinstance(slot_value.get("value"), dict) else slot_value.get("value")
                else:
                    v1_event["currentIntent"]["slots"][slot_name] = None
    
    return v1_event

def convert_v1_to_v2_response(v1_response, original_v2_event):
    # Initialize basic V2 response structure
    print("lambda before : ",v1_response)
    print("lambda before : ",v1_response)
    v2_response = {
        "sessionState": {
            "dialogAction": {
                "type": "Close"  # Default, will be updated based on V1 response
            },
            "intent": {
                "name": original_v2_event.get("sessionState", {}).get("intent", {}).get("name", ""),
                "state": "Fulfilled"  # Default, will be updated
            },
            "sessionAttributes": {}
        },
        "messages": []
    }
    
    # Map session attributes
    if "sessionAttributes" in v1_response:
        v2_response["sessionState"]["sessionAttributes"] = v1_response["sessionAttributes"]
    
    # Map dialog action type
    if "dialogAction" in v1_response:
        dialog_type = v1_response["dialogAction"].get("type")
        
        if dialog_type == "Close":
            v2_response["sessionState"]["dialogAction"]["type"] = "Close"
            fulfillment_state = v1_response["dialogAction"].get("fulfillmentState")
            
            if fulfillment_state == "Fulfilled":
                v2_response["sessionState"]["intent"]["state"] = "Fulfilled"
            else:
                v2_response["sessionState"]["intent"]["state"] = "Failed"
                
        elif dialog_type == "ElicitSlot":
            print("elicit slot : ",v1_response["dialogAction"].get("slotToElicit"))
            v2_response["sessionState"]["dialogAction"]["type"] = "ElicitSlot"
            v2_response["sessionState"]["dialogAction"]["slotToElicit"] = v1_response["dialogAction"].get("slotToElicit")
            v2_response["sessionState"]["intent"]["state"] = "InProgress"
            
        elif dialog_type == "ElicitIntent":
            v2_response["sessionState"]["dialogAction"]["type"] = "ElicitIntent"
            v2_response["sessionState"]["intent"]["state"] = "InProgress"
            
        elif dialog_type == "ConfirmIntent":
            v2_response["sessionState"]["dialogAction"]["type"] = "ConfirmIntent"
            v2_response["sessionState"]["intent"]["state"] = "InProgress"
            
        elif dialog_type == "Delegate":
            v2_response["sessionState"]["dialogAction"]["type"] = "Delegate"
            v2_response["sessionState"]["intent"]["state"] = "InProgress"
    
    # Map slots if provided in the V1 response
    if "dialogAction" in v1_response and "slots" in v1_response["dialogAction"]:
        v1_slots = v1_response["dialogAction"]["slots"]
        v2_slots = {}
        
        if v1_slots:
            for slot_name, slot_value in v1_slots.items():
                if slot_value is not None:
                    v2_slots[slot_name] = {
                        "value": {
                            "originalValue": slot_value,
                            "interpretedValue": slot_value
                        }
                    }
                else:
                    v2_slots[slot_name] = None
                    
            v2_response["sessionState"]["intent"]["slots"] = v2_slots
        
    # Map response messages
    if "dialogAction" in v1_response and "message" in v1_response["dialogAction"]:
        v1_message = v1_response["dialogAction"]["message"]
        
        v2_message = {
            "contentType": "PlainText",  # Default
            "content": ""
        }
        
        if "contentType" in v1_message:
            if v1_message["contentType"] == "PlainText":
                v2_message["contentType"] = "PlainText"
            elif v1_message["contentType"] == "SSML":
                v2_message["contentType"] = "SSML"
            elif v1_message["contentType"] == "CustomPayload":
                v2_message["contentType"] = "CustomPayload"
        
        if "content" in v1_message:
            v2_message["content"] = v1_message["content"]
            
        v2_response["messages"].append(v2_message)
    
# Handle multiple messages if provided in responseCard buttons
    if "dialogAction" in v1_response and "responseCard" in v1_response["dialogAction"]:
        response_card = v1_response["dialogAction"]["responseCard"]
        
        if "genericAttachments" in response_card:
            for attachment in response_card["genericAttachments"]:
                if "buttons" in attachment:
                    # Check if there are any buttons to display
                    if not attachment["buttons"]:
                        continue
                        
                    # Create basic card data
                    title = attachment.get("title") or "Please select from below options:"
                    subtitle = attachment.get("subTitle", "")
                    image_url = attachment.get("imageUrl", "")
                    
                    # Create card structure
                    card_message = {
                        "contentType": "ImageResponseCard",
                        "imageResponseCard": {
                            "title": title,
                            "buttons": []
                        }
                    }
                    
                    # Add subtitle if not empty
                    if subtitle:
                        card_message["imageResponseCard"]["subtitle"] = subtitle
                    
                    # Add imageUrl only if it exists and is valid (not empty and within length constraints)
                    if image_url and len(image_url) <= 250:
                        card_message["imageResponseCard"]["imageUrl"] = image_url
                    
                    # Add buttons
                    for button in attachment["buttons"]:
                        card_message["imageResponseCard"]["buttons"].append({
                            "text": button.get("text", ""),
                            "value": button.get("value", "")
                        })
                    
                    v2_response["messages"].append(card_message)
    
    return v2_response`;
}

function endConversationNextStep() {
  // Shared fallback fulfillment branches all end the conversation.
  return {
    "sessionAttributes": {},
    "dialogAction": {
      "type": "EndConversation",
      "slotToElicit": null,
      "intentsInScope": null,
      "suppressNextMessage": null
    },
    "intent": {
      "name": null,
      "slots": {}
    }
  };
}
