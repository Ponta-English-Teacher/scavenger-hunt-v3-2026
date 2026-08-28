import StudentActivity from "./student-activity";
export default async function ActivityPage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <StudentActivity activityId={id}/>}
