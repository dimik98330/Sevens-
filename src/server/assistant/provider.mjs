// One paid request per user turn. No provider retries, tools, or stored conversation.
export async function openAiReply({ payload, signal, apiKey }) {
  if (!apiKey) throw new Error('Assistant API key is not configured');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Assistant provider unavailable');
  const result = await response.json();
  if (result.status !== 'completed') throw new Error('Assistant response incomplete');
  const contents = (result.output || []).flatMap((item) => item.content || []);
  if (contents.some((item) => item.type === 'refusal')) throw new Error('Assistant provider refused');
  const text = contents.filter((item) => item.type === 'output_text')
    .map((item) => item.text).join('');
  return JSON.parse(text);
}
