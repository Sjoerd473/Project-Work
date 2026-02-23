from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


app = FastAPI()
templates = Jinja2Templates(directory="templates")

app.mount("/static", StaticFiles(directory="static"), name="static")
         
@app.post("/events")
async def receive_event(request: Request):
    data = await request.json()
    print("Received event:", data)
    return {"status": "received"}




@app.get('/', response_class=HTMLResponse)
async def home(request: Request):
    data = {"message": "Hello worlds!"}

    # if "application/json" in request.headers.get("accept", ""):
    #     return JSONResponse(data)
    
    return templates.TemplateResponse("base.html", {"request": request, "data": data})

@app.get('/boop', response_class=HTMLResponse)
async def boop():
    return """
    <html>
    <p>This is a HTML response</p>
    </html>


"""