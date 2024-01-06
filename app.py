from route_finder import RouteFinder
from quart import Quart
from quart import render_template
from quart import request
import socketio as pysocketio
import asyncio
from hypercorn.config import Config
from hypercorn.asyncio import serve
import numpy as np
import cv2
import base64
import networkx as nx
import json
import uuid

app = Quart(__name__)
socketio = pysocketio.AsyncServer(async_mode='asgi')
socketio_app = pysocketio.ASGIApp(socketio, app)

@app.route("/")
async def index():
    return await render_template("index.html")

route_finder_instances = {}
crop_img_sources = {}
clean_path_sources = {}
close_gaps_sources = {}

@app.post("/")
async def start():
    global route_finder_instances

    if (await request.files)["fileInput"].filename.endswith("routefinder"):
        filestr = (await request.files)["fileInput"].read()
        data = json.loads(filestr)

        decoded_img = base64.b64decode(data["img"][data["img"].index(",")+1:])
        decoded_img = np.frombuffer(decoded_img, np.uint8)
        img = cv2.imdecode(decoded_img, cv2.IMREAD_COLOR)
        route_finder = RouteFinder(img)
        route_finder.path = np.array(data["path_mask"])
        route_finder.graph = nx.node_link_graph(data["graph"])

    else: 
        filestr = (await request.files)["fileInput"].read()
        file_bytes = np.frombuffer(filestr, np.uint8)
        img = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
        route_finder = RouteFinder(img)

    temp_id = uuid.uuid4().hex
    route_finder_instances[temp_id] = route_finder

    return await render_template("main.html", temp_id = temp_id)

def img_to_data_url(img):
    _, buffer = cv2.imencode('.png', img)
    encoded = base64.b64encode(buffer)
    return f"data:image/png;base64,{encoded.decode('ascii')}"

@socketio.on("connectionEstablished")
async def connection(id, temp_id):
    route_finder_instances[id] = route_finder_instances[temp_id]
    del route_finder_instances[temp_id]

    await socketio.emit("image", {"url": img_to_data_url(route_finder_instances[id].original_img), "width":route_finder_instances[id].original_img.shape[1], "height":route_finder_instances[id].original_img.shape[0]}, room=id)

    if not hasattr(route_finder_instances[id], "graph"):
        await socketio.emit("cropImg", img_to_data_url(route_finder_instances[id].original_img), room=id)   
    else:
        await socketio.emit("showNavigator", nx.node_link_data(route_finder_instances[id].graph), room=id)

@socketio.on("cropImgArgs")
async def handle_crop_img_arguments(id, args):
    global crop_img_sources
    if not id in crop_img_sources.keys():
        crop_img_sources[id] = route_finder_instances[id].original_img.copy()
    route_finder_instances[id].original_img = crop_img_sources[id].copy()

    if len(args["points"]) != 0:
        await asyncio.get_event_loop().run_in_executor(None, route_finder_instances[id].crop_img, args["points"])
    await asyncio.get_event_loop().run_in_executor(None, route_finder_instances[id].preprocess)
    
    await socketio.emit("getPath", img_to_data_url(route_finder_instances[id].img), room=id)

@socketio.on("readjustCropImg")
async def readjust_crop_img(id):
    return img_to_data_url(crop_img_sources[id])

@socketio.on("getPathArgs")
async def handle_get_path_arguments(id, args):
    await asyncio.get_event_loop().run_in_executor(None, route_finder_instances[id].get_path, args["points"])
    result = route_finder_instances[id].original_img.copy()
    result[route_finder_instances[id].path] = [0, 255, 0]
    result[np.invert(route_finder_instances[id].path)] = [0, 0, 0]

    await socketio.emit("cleanPath", img_to_data_url(result), room=id)

@socketio.on("readjustGetPath")
async def readjust_get_path(id):
    return img_to_data_url(route_finder_instances[id].img)
        
@socketio.on("cleanPathArgs")
async def handle_clean_path_arguments(id, args):
    global clean_path_sources
    if not id in clean_path_sources.keys():
        clean_path_sources[id] = route_finder_instances[id].path.copy()
    route_finder_instances[id].path = clean_path_sources[id].copy()

    await asyncio.get_event_loop().run_in_executor(None, route_finder_instances[id].clean_path, args)
    result = route_finder_instances[id].original_img.copy()
    result[route_finder_instances[id].path] = [0, 255, 0]
    result[np.invert(route_finder_instances[id].path)] = [0, 0, 0]

    await socketio.emit("closeGaps", img_to_data_url(result), room=id)

@socketio.on("closeGapsArgs")
async def handle_close_gaps_arguments(id, args):
    global close_gaps_sources
    if not id in close_gaps_sources.keys():
        close_gaps_sources[id] = route_finder_instances[id].path.copy()
    route_finder_instances[id].path = close_gaps_sources[id].copy()

    await asyncio.get_event_loop().run_in_executor(None, route_finder_instances[id].close_gaps, args["pointsToCheck"], args["triangleLength"], args["triangleSpreadAngle"])
    result = route_finder_instances[id].original_img.copy()
    result[route_finder_instances[id].path] = [0, 255, 0]
    result[np.invert(route_finder_instances[id].path)] = [0, 0, 0]

    await socketio.emit("closeGapsResult", img_to_data_url(result), room=id)

@socketio.on("getGraph")
async def getGraph(id):
    await asyncio.get_event_loop().run_in_executor(None, route_finder_instances[id].get_graph_from_path)

    await socketio.emit("showNavigator", nx.node_link_data(route_finder_instances[id].graph), room=id)

@socketio.on("findRoute")
async def find_route(id, req):
    route, reversed_targets = await asyncio.get_event_loop().run_in_executor(None, route_finder_instances[id].find_route, tuple(req["start"]), tuple(req["end"]))

    await socketio.emit("route", {"route": route.tolist(), "reversed": reversed_targets}, room=id)

@socketio.on("save")
async def handle_save_request(id):
    return {
        "graphData": nx.node_link_data(route_finder_instances[id].graph),
        "pathMask": route_finder_instances[id].path.tolist()
    }

@socketio.on("disconnect")
async def handle_disconnection(id):
    global route_finder_instances, crop_img_sources, clean_path_sources, close_gaps_sources

    if id in route_finder_instances.keys():
        del route_finder_instances[id]
    if id in crop_img_sources.keys():
        del crop_img_sources[id]
    if id in clean_path_sources.keys():
        del clean_path_sources[id]
    if id in close_gaps_sources.keys():
        del close_gaps_sources[id]

if __name__ == '__main__':
    config = Config()
    config.bind = ["192.168.178.41:8080"]
    asyncio.run(serve(socketio_app, config))
