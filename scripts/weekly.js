// Scheduler calls the existing service so there is only one active worker.
const week=Number(process.argv[2]);if(!Number.isInteger(week)||week<1||week>25)throw Error('Usage: npm run weekly -- <ESPN matchup period>');
const response=await fetch(`http://127.0.0.1:${process.env.PORT||8787}/api/weekly`,{method:'POST',headers:{Authorization:`Bearer ${process.env.ADMIN_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({week}),signal:AbortSignal.timeout(180000)});
const body=await response.json();if(!response.ok)throw Error(body.error);console.log(`Edition ${body.id}: ${body.status}. the owner review required.`);



