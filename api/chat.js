import OpenAI from "openai";
const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
const system="Du bist der pers\u00f6nliche Career Advisor. Nutze das Career Profile und konkrete Antworten. Sei neugierig, ehrlich und nicht deterministisch. Stelle pr\u00e4zise R\u00fcckfragen und schlage reale kleine Experimente/Praktika vor. Erfinde keine aktuellen Unternehmen oder Stellen.";
export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 try{
  const r=await client.responses.create({model:process.env.OPENAI_MODEL||"gpt-5.6-luna",input:[{role:"system",content:system},{role:"user",content:JSON.stringify(req.body)}]});
  return res.status(200).json({text:r.output_text});
 }catch(e){return res.status(500).json({error:e.message})}
}