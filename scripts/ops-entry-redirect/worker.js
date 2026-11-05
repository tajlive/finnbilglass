// The two existing exact /ops routes use this Worker. Never render an unprotected admin UI.
export default {fetch(request){
 const u=new URL(request.url);
 if(request.method!=='GET'||u.pathname!=='/ops')return new Response('Not found',{status:404});
 return new Response(null,{status:302,headers:{Location:'https://ops.finnbilglass.no/ops','Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
}};
