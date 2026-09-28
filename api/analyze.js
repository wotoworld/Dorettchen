import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const system="Du bist Career Discovery Analyst. Keine psychologische Diagnose, kein endg\u00fcltiges Urteil. Analysiere Antworten auf stabile Pr\u00e4ferenzen, Trade-offs, Widerspr\u00fcche und \u00fcberraschende Kombinationen. Rankings sind besonders aussagekr\u00e4ftig. Erfinde nichts. Erzeuge 8\u201312 neue Folgefragen, die konkrete Unsicherheiten oder Widerspr\u00fcche testen und keine ersten Fragen wiederholen. JSON: headline, summary, themes[{name,description}], tensions[{title,detail}], hypotheses[{title,reason}], followup_questions[{id,question,options[4]}].";
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 try{
  const r=await client.responses.create({model:process.env.OPENAI_MODEL||"gpt-5.6-luna",input:[{role:"system",content:system},{role:"user",content:JSON.stringify(req.body)}],text:{format:{type:"json_object"}}});
  return res.status(200).json(JSON.parse(r.output_text));
 }catch(e){return res.status(500).json({error:e.message})}
}
