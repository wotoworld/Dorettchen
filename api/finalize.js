import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const system="Du bist die finale Career-Discovery-Analystin. Nutze Erstfragebogen, Folgefragen und erste Analyse. Erstelle eine intensive, nicht-deterministische Career Map. Formuliere Berufsideen als Hypothesen und Experimente. Ber\u00fccksichtige Pr\u00e4ferenzen, konkrete Entscheidungen, Rankings, Widerspr\u00fcche, Arbeitsumgebung, Menschenkontakt, Kreativit\u00e4t, Autonomie, Risiko/Sicherheit, Internationalit\u00e4t, Business/Analyse, Lebensstil und Lernbed\u00fcrfnis. Erzeuge 6\u201310 konkrete Richtungen; je Richtung why und test. Erg\u00e4nze \u00fcberraschende Schnittstellen und konkrete next_steps. JSON: headline, summary, themes[{name,description}], directions[{title,why,test}], tensions[{title,detail}], next_steps[].";
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 try{
  const r=await client.responses.create({model:model:process.env.OPENAI_MODEL||"gpt-5.6-sol",
reasoning:{effort:"high"},input:[{role:"system",content:system},{role:"user",content:JSON.stringify(req.body)}],text:{format:{type:"json_object"}}});
  return res.status(200).json(JSON.parse(r.output_text));
 }catch(e){return res.status(500).json({error:e.message})}
}
