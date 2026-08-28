"use client";

import { useState } from "react";

const prompts = [
  { question: "Find someone who has visited another country.", followUp: "Which country did they visit? What did they enjoy there?" },
  { question: "Find someone who can cook a special dish.", followUp: "What can they cook? Who taught them?" },
  { question: "Find someone who enjoys the same kind of music as you.", followUp: "Which artist or song do you both like?" },
  { question: "Find someone who has an unusual hobby.", followUp: "How did they start it?" },
  { question: "Find someone who woke up before 6:00 this morning.", followUp: "Why did they wake up so early?" },
  { question: "Find someone who has met a famous person.", followUp: "Who did they meet, and where?" },
  { question: "Find someone who prefers mountains to the sea.", followUp: "What do they like doing in the mountains?" },
  { question: "Find someone who has tried a new food recently.", followUp: "What was it? Did they like it?" },
  { question: "Find someone who is learning something outside class.", followUp: "What are they learning, and why?" },
  { question: "Find someone who has a pet or would like one.", followUp: "What animal? What would its name be?" },
  { question: "Find someone who enjoys reading.", followUp: "What book or story would they recommend?" },
  { question: "Find someone who played a sport this week.", followUp: "Which sport? Who did they play with?" },
  { question: "Find someone who watched a good film or series recently.", followUp: "What was it about?" },
  { question: "Find someone who wants to visit the same place as you.", followUp: "Where do you both want to go, and why?" },
  { question: "Find someone who can play a musical instrument.", followUp: "Which instrument? How long have they played it?" },
  { question: "Find someone who has an interesting weekend plan.", followUp: "What are they going to do?" },
  { question: "Find someone who likes studying in the same place as you.", followUp: "Why is that place good for studying?" },
  { question: "Find someone who has learned a useful life skill.", followUp: "What skill is it? When do they use it?" },
  { question: "Find someone who has a goal for this year.", followUp: "What is their goal? What is their first step?" },
  { question: "Find someone who can recommend a place near campus.", followUp: "Where is it? What can you do there?" },
  { question: "Find someone who has the same favorite season as you.", followUp: "What do you both like doing in that season?" },
  { question: "Find someone who has done something challenging.", followUp: "What did they do? How did they feel afterward?" },
  { question: "Find someone who uses English outside class.", followUp: "Where and how do they use it?" },
  { question: "Find someone who can teach you something in one minute.", followUp: "What can they teach you? Try it!" },
];

export default function Home() {
  const [selected, setSelected] = useState<number | null>(null);
  const prompt = selected === null ? null : prompts[selected - 1];
  return <main>
    <header className="topbar"><div className="brand"><span className="brandMark">SH</span><span>Scavenger Hunt</span></div><span className="classTag">CLASS ACTIVITY</span></header>
    <section className="hero"><p className="eyebrow">READY, SET, SPEAK!</p><h1>Your number.<br /><em>Your mission.</em></h1><p className="intro">Choose the number your teacher assigned to you. Read your mission, then stand up and find a classmate who matches it.</p></section>
    <section className="activity" aria-live="polite">
      {prompt ? <div className="missionCard">
        <button className="backButton" onClick={() => setSelected(null)}>← Choose another number</button>
        <div className="missionNumber">MISSION {String(selected).padStart(2, "0")}</div><h2>{prompt.question}</h2>
        <div className="followUp"><span>ASK MORE</span><p>{prompt.followUp}</p></div>
        <div className="steps"><span>1. Find someone</span><span>2. Ask the question</span><span>3. Remember their answer</span></div>
      </div> : <><div className="sectionHeading"><h2>Choose your number</h2><span>{prompts.length} missions</span></div><div className="numberGrid">{prompts.map((_, index) => <button key={index} onClick={() => setSelected(index + 1)} aria-label={`Choose mission ${index + 1}`}><span>{String(index + 1).padStart(2, "0")}</span></button>)}</div></>}
    </section>
    <footer><span>Speak English. Meet someone new. Be curious.</span><span>GOOD LUCK!</span></footer>
  </main>;
}
