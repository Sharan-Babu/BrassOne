import { GoogleGenerativeAI } from "@google/generative-ai";

const TIDB_API_URL = 'https://us-east-1.data.tidbcloud.com/api/v1beta/app/dataapp-XvsODSYc/endpoint/';
const PUBLIC_KEY = '';
const PRIVATE_KEY = '';
const GEMINI_API_KEY = '';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function tidbRequest(method, endpoint, data = null) {
  const url = `${TIDB_API_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + btoa(`${PUBLIC_KEY}:${PRIVATE_KEY}`)
  };

  const options = {
    method,
    headers,
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`TiDB request failed: ${response.statusText}`);
  }
  return response.json();
}

async function getEmbedding(text) {
  const model = genAI.getGenerativeModel({ model: "text-embedding-004"});
  const result = await model.embedContent(text);
  return result.embedding.values;
}

async function manipulateTableRecord(userAutomation, existingAutomations) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "You will be given a description of an automation/modifications to make on a webpage along with certain existing ones. Your task is to return a JSON according to the schema given below without asking clarifying questions or talking anything else:\n{\n  \"action\": \"create\"/\"delete\"/\"edit\",\n  \"current_automation_desc\": the automation_description that you are going to delete or edit (verbatim),\n  \"new_automation_desc\": the new automation_description when you create or edit,\n  \"always\": -1 if delete action, else, 1 if the automation applies to multiple domains of a category or 0 if it is specific and has to be run only for certain domain or website\n}\n\nExample 1 Input:\n------\nUser automation: \"Non entertainment based youtube videos should have a playback speed of 1.5x\"\n\nExisting automations:\nid | automation_description\n2  | convert everthing in dollars to rupees\n\nExample 1 Output JSON:\n{\n  \"action\": \"create\",\n  \"new_automation_desc\": \"Playback speed of YouTube videos that are not related to entertainment should be set to 1.5x\",\n  \"always\": 0\n}\n------",
  });

  const generationConfig = {
    temperature: 0,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 1000,
  };

  try {
    const chatSession = model.startChat({ generationConfig });
    const result = await chatSession.sendMessage(
      `User automation: "${userAutomation}"\nExisting automations:\nid | automation_description\n${existingAutomations}`
    );

    const response = JSON.parse(result.response.text());
    console.log('LLM response:', JSON.stringify(response));
    return response;
  } catch (error) {
    console.error('Error in LLM processing:', error);
    return {
      action: "create",
      new_automation_desc: userAutomation,
      always: 0
    };
  }
}

async function handleStoreAutomation(request) {
  const { automationText, userId } = await request.json();

  console.log('Received automation text:', automationText);

  const embedding = await getEmbedding(automationText);
  console.log('Generated embedding');

  const searchResponse = await tidbRequest('POST', 'brass/vector_search', {
    query_vector: JSON.stringify(embedding),
    userid: userId
  });

  let existingAutomations = "No existing automations found.";
  if (searchResponse.data && searchResponse.data.rows && searchResponse.data.rows.length > 0) {
    existingAutomations = searchResponse.data.rows.map(row => `${row.id} | ${row.automation_desc}`).join('\n');
  }
  console.log('Existing automations:', existingAutomations);

  const llmSuggestion = await manipulateTableRecord(automationText, existingAutomations);
  console.log('LLM suggestion:', JSON.stringify(llmSuggestion));

  let actionResponse;
  switch (llmSuggestion.action) {
    case 'create':
      actionResponse = await tidbRequest('POST', 'brass', {
        always: llmSuggestion.always,
        automation_desc: llmSuggestion.new_automation_desc,
        automation_embedding: JSON.stringify(embedding),
        user_id: userId
      });
      break;
    case 'delete':
      actionResponse = await tidbRequest('DELETE', `brass?user_id=${userId}&automation_desc=${encodeURIComponent(llmSuggestion.current_automation_desc)}`);
      break;
    case 'edit':
      await tidbRequest('DELETE', `brass?user_id=${userId}&automation_desc=${encodeURIComponent(llmSuggestion.current_automation_desc)}`);
      actionResponse = await tidbRequest('POST', 'brass', {
        always: llmSuggestion.always,
        automation_desc: llmSuggestion.new_automation_desc,
        automation_embedding: JSON.stringify(embedding),
        user_id: userId
      });
      break;
    default:
      throw new Error('Invalid action suggested by LLM');
  }

  return new Response(JSON.stringify({ message: 'Automation processed successfully', data: actionResponse }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function handleGetAutomationResults(request) {
  const { pageContent, domain, title, userId } = await request.json();

  const embedding = await getEmbedding(`${domain} ${title}`);

  const searchResponse = await tidbRequest('POST', 'brass/vector_search', {
    query_vector: JSON.stringify(embedding),
    userid: userId
  });

  let existingAutomations = "No existing automations found.";
  if (searchResponse.data && searchResponse.data.rows && searchResponse.data.rows.length > 0) {
    existingAutomations = searchResponse.data.rows.map(row => `${row.id} | ${row.automation_desc}`).join('\n');
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: "You will be given the text content of a webpage along with the existing automations. Think out carefully about which automations will apply. Then, within double curly braces {{...}}, give me formatted HTML that represents answer with ALL (strictly) the relevant automations applied. Our intention is not to give back a whole webpage, the result will be shown on a chrome extension with the automations combined and applied for quick effective information consumption. If no existing automations are relevant, then just return {{none}}",
  });

  const generationConfig = {
    temperature: 0,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 4000,
  };

  const chatSession = model.startChat({ generationConfig });
  const result = await chatSession.sendMessage(`Website text: \n${pageContent}\n\n-----------\nExisting automations:\nid | automation_description\n${existingAutomations}`);

  const llmResponse = result.response.text();
  const htmlMatch = llmResponse.match(/{{(.+?)}}/s);
  const html = htmlMatch ? htmlMatch[1].trim() : 'none';

  return new Response(JSON.stringify({ message: 'Automation results generated successfully', data: { html } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function handleCORS(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  return headers;
}

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = handleCORS(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    
    try {
      if (request.method === 'POST') {
        if (url.pathname === '/store-automation') {
          const response = await handleStoreAutomation(request);
          return new Response(response.body, {
            status: response.status,
            headers: { ...corsHeaders, ...response.headers }
          });
        } else if (url.pathname === '/get-automation-results') {
          const response = await handleGetAutomationResults(request);
          return new Response(response.body, {
            status: response.status,
            headers: { ...corsHeaders, ...response.headers }
          });
        }
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};