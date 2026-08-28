type GeneratorItem={text?:string;followUp?:string;hint?:string;grammarTag?:string};
export async function POST(request:Request){
  try{
    const body=await request.json();
    const count=Math.max(1,Math.min(20,Number(body.count)||5));
    const upstream=await fetch("https://classroom-question-builder.vercel.app/api/generate-questions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...body,count,followUps:true,includeHints:true})});
    const data=await upstream.json() as {ok?:boolean;items?:GeneratorItem[];error?:string};
    if(!upstream.ok||!data.ok||!Array.isArray(data.items))return Response.json({error:data.error||"The original question generator is unavailable."},{status:502});
    const items=data.items.map((item,i)=>({id:`q${i+1}`,text:String(item.text||"").trim(),followUp:String(item.followUp||"").trim(),hint:String(item.hint||"").trim(),grammarTag:String(item.grammarTag||"").trim()})).filter(item=>item.text);
    return Response.json({items});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"Question generation failed."},{status:500})}
}
