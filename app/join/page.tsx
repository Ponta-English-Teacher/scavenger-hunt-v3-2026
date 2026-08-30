"use client";
import {useEffect,useState} from "react";
export default function JoinPage(){
  const[code,setCode]=useState(""),[status,setStatus]=useState<"idle"|"loading"|"error">("idle"),[error,setError]=useState("");
  async function resolve(rawCode:string){const trimmed=rawCode.trim();if(!/^\d{4}$/.test(trimmed)){setStatus("error");setError("Enter the 4-digit activity code.");return}setStatus("loading");setError("");try{const response=await fetch(`/api/activities?code=${encodeURIComponent(trimmed)}`);const data=await response.json() as {data?:string;error?:string};if(!response.ok||!data.data)throw new Error(data.error||"This code is invalid or has expired.");window.location.href=`/activity#data=${data.data}`}catch(e){setStatus("error");setError(e instanceof Error?e.message:"This code is invalid or has expired.")}}
  // A QR code encodes /join?code=XXXX so scanning it resolves automatically,
  // with no manual typing — reads the query param directly (no next/navigation
  // hook) to match how /activity/page.tsx already reads location.hash, and to
  // avoid the useSearchParams-needs-Suspense requirement entirely.
  useEffect(()=>{const fromUrl=new URLSearchParams(window.location.search).get("code");if(!fromUrl)return;const digits=fromUrl.replace(/\D/g,"").slice(0,4);setCode(digits);if(/^\d{4}$/.test(digits))resolve(digits)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function onSubmit(e:React.FormEvent){e.preventDefault();resolve(code)}
  return <main className="studentPage"><div className="studentShell joinShell"><p className="eyebrow">QUESTION BUILDER</p><h1>Scavenger Hunt</h1><p>Enter your activity code</p><form className="joinForm" onSubmit={onSubmit}><input value={code} onChange={e=>{setCode(e.target.value.replace(/\D/g,"").slice(0,4));setStatus("idle")}} inputMode="numeric" pattern="[0-9]*" maxLength={4} placeholder="0000" autoFocus/><button type="submit" disabled={status==="loading"}>{status==="loading"?"Joining…":"Join"}</button></form>{status==="error"&&<p className="errorInline">{error}</p>}</div></main>
}
