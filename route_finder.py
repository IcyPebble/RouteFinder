import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
import math
from skimage.morphology import skeletonize, disk
from skimage.draw import polygon2mask
from scipy.ndimage import label, binary_dilation
import cv2
import shapely
import networkx as nx
from scipy.spatial import KDTree

class RouteFinder:
    def __init__(self, input_img):
        # Resize
        scale_factor = np.min((1200 / np.max(input_img.shape[:2]), 1))
        width = int(input_img.shape[1] * scale_factor)
        height = int(input_img.shape[0] * scale_factor)
        dim = (width, height)
        self.original_img = cv2.resize(input_img, dim, interpolation = cv2.INTER_AREA)
    
    def crop_img(self, points):
        polygon = polygon2mask(self.original_img.shape[:2], np.array(points))
        self.original_img[np.invert(polygon)] = [255, 255, 255]

    def preprocess(self, kmeans=12):
        '''
        Apply k-Means clustering
        '''

        img = cv2.cvtColor(self.original_img, cv2.COLOR_BGR2Lab)

        X = img.reshape((-1,3))
        X = np.float32(X)

        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
        k = kmeans
        _, labels, centers = cv2.kmeans(
            X, k, None, criteria, 10, cv2.KMEANS_PP_CENTERS
        )

        centers = np.uint8(centers)
        res = centers[labels.flatten()]
        res2 = res.reshape((img.shape))
        res2 = cv2.cvtColor(res2, cv2.COLOR_Lab2BGR)

        self.img = res2

    def get_path(self, target_color_pixels):
        '''
        Get path by color
        '''

        path = np.zeros(self.img.shape, dtype=self.img.dtype)

        for target_color_pixel in target_color_pixels:
            target_color = self.img[tuple(target_color_pixel)]
            path[((self.img[:, :, 0] == target_color[0]) & (self.img[:, :, 1] == target_color[1]) & (self.img[:, :, 2] == target_color[2]))] = [255, 0, 0]

        kernel = np.ones((10, 10), np.uint8)
        path = cv2.morphologyEx(path, cv2.MORPH_CLOSE, kernel)
        path = skeletonize(path).any(-1)

        self.path = path

        return self.path

    def clean_path(self, threshold=24):
        '''
        Remove pixel groups if the diagonal is shorter than the threshold value
        '''

        labels, n_labels = label(self.path, np.ones((3, 3)))
        for n in range(1, n_labels+1):
            x, y = np.where(labels == n)
            dist = math.dist((np.min(x), np.min(y)), (np.max(x), np.max(y)))

            if dist <= threshold:
                self.path[x, y] = False
        
        return self.path

    def _get_endpoints(self):
        pixel_neighbours = sliding_window_view(np.pad(self.path, 1, constant_values=(False)), (3, 3)).reshape((-1, 9))
        endpoints = np.where(pixel_neighbours[:, 4] & (np.count_nonzero(pixel_neighbours, axis=1) == 2))
        endpoints = np.indices(self.path.shape).transpose(1, 2, 0).reshape(-1, 2)[endpoints]
        endpoints = (endpoints[:, 0], endpoints[:, 1])

        return endpoints

    def _get_next_point(self, path, ref):
        r, c = path[-1]
        neighbours = np.array([
            coord for coord in [
                [r-1, c-1], [r-1, c], [r-1, c+1],
                [r, c-1], [r, c+1],
                [r+1, c-1], [r+1, c], [r+1, c+1]
            ] if (coord not in path.tolist()) and (coord[0] in range(ref.shape[0]) and coord[1] in range(ref.shape[1]))
        ])
        neighbours = neighbours[ref[neighbours[:, 0], neighbours[:, 1]]]

        if len(neighbours):
            return neighbours[0]
        return

    def _get_triangle(self, endpoint, linepoint, length, spread_angle):
        x1, y1 = endpoint
        x2, y2 = linepoint

        extended_point = (x2 + length*(x1 - x2), y2 + length*(y1 - y2))

        ox, oy = endpoint
        px, py = extended_point

        angle = spread_angle/2 * np.pi/180
        arm_point1 = (
            ox + np.cos(angle) * (px - ox) - np.sin(angle) * (py - oy),
            oy + np.sin(angle) * (px - ox) + np.cos(angle) * (py - oy)
        )

        angle = (360-spread_angle/2) * np.pi/180
        arm_point2 = (
            ox + np.cos(angle) * (px - ox) - np.sin(angle) * (py - oy),
            oy + np.sin(angle) * (px - ox) + np.cos(angle) * (py - oy)
        )

        return shapely.Polygon([endpoint, arm_point1, extended_point, arm_point2])

    def close_gaps(self, points_to_check=3, triangle_length=12, triangle_spread_angle=45):
        '''
        Close path gaps using triangles
        '''

        endpoints = self._get_endpoints()

        # Compute triangles
        triangles = []
        for endpoint in zip(*endpoints):
            point_path = np.array([endpoint])
            i = 0
            while i < points_to_check:
                next_point = self._get_next_point(point_path, self.path)
                if next_point is None:
                    break

                point_path = np.vstack((point_path, next_point))
                i += 1

            triangle = self._get_triangle(
                endpoint, point_path[-1], triangle_length, triangle_spread_angle
            )

            triangles.append((shapely.Point(endpoint), triangle))

        img_indices = np.indices(self.path.shape).transpose(1, 2, 0).reshape(-1, 2)
        linepoints = img_indices[self.path.flatten()]
        linepoints = shapely.multipoints(list(zip(linepoints[:, 0], linepoints[:, 1])))
        endpoints = shapely.multipoints(list(zip(*endpoints)))

        for endpoint, triangle in triangles:
            connection_point = None

            # Find possible connection point of the end points
            intersecting_endpoints = shapely.intersection_all([triangle, endpoints])
            if intersecting_endpoints and not isinstance(intersecting_endpoints, shapely.Point):
                shortest_distance = np.inf
                for point in intersecting_endpoints.geoms:
                    distance = shapely.distance(point, endpoint)
                    if (not point.equals(endpoint)) and distance < shortest_distance:
                        shortest_distance = distance
                        connection_point = point
            
            else:
                # Find possible connection point of the line points
                intersecting_linepoints = shapely.intersection_all([triangle, linepoints])
                line_distance = np.inf
                nearest_linepoint = None
                if intersecting_linepoints and not isinstance(intersecting_endpoints, shapely.Point):
                    for point in intersecting_linepoints.geoms:
                        distance = shapely.distance(point, endpoint)
                        if (not point.equals(endpoint)) and distance < line_distance:
                            line_distance = distance
                            nearest_linepoint = point
                
                # Find possible connection point of the end points of intersecting triangles
                triangle_distance = np.inf
                nearest_trianglepoint = None
                for other_endpoint, other_triangle in triangles:
                    if (not other_endpoint.equals(endpoint)) and shapely.intersects(other_triangle, triangle):
                        distance = shapely.distance(other_endpoint, endpoint)
                        if distance < triangle_distance:
                            triangle_distance = distance
                            nearest_trianglepoint = other_endpoint
                
                # Choose closest connection point 
                if nearest_linepoint or nearest_trianglepoint:
                    if line_distance < triangle_distance:
                        connection_point = nearest_linepoint
                    else:
                        connection_point = nearest_trianglepoint
            
            if connection_point:
                # Draw line to connection point
                p1 = tuple(reversed((int(endpoint.x), int(endpoint.y))))
                p2 = tuple(reversed((int(connection_point.x), int(connection_point.y))))
                self.path = np.bool_(cv2.line(np.float32(self.path), p1, p2, 1))
                linepoints = img_indices[self.path.flatten()]
                linepoints = shapely.multipoints(list(zip(linepoints[:, 0], linepoints[:, 1])))
        
        return self.path
    
    def get_graph_from_path(self):
        indices = np.indices(self.path.shape).transpose(1, 2, 0).reshape(*self.path.shape, 2)
        indices[np.invert(self.path)] = [-1, -1]

        neighbourhoods = sliding_window_view(np.pad(indices, ((1,), (1,), (0,)), constant_values=(-1)), (3, 3), axis=(0,1)).reshape(-1, 9)
        neighbourhoods = np.vstack((neighbourhoods[::2].flatten(), neighbourhoods[1::2].flatten())).T.reshape(-1, 9, 2)

        edges = np.hstack((neighbourhoods[:, 5:].reshape(-1, 2), np.repeat(neighbourhoods[:, 4], 4, axis=0))).reshape(-1, 2, 2)
        edges = edges[np.invert((edges == -1).any(-1).any(-1))].tolist()
        edges = map(lambda edge: tuple(map(tuple, edge)), edges)

        G = nx.Graph()
        G.add_edges_from(edges)

        self.graph = G
        return self.graph
    
    def find_route(self, start_pos, end_pos):
        labeled_path, _ = label(self.path, structure=np.ones((3, 3)))
        path_points = np.vstack(np.where(self.path)).T
        kdtree = KDTree(path_points)

        start = tuple(path_points[kdtree.query(start_pos)[1]])
        alt_start = tuple(path_points[kdtree.query(end_pos)[1]])

        path_points = np.vstack(np.where(labeled_path == labeled_path[start])).T
        kdtree = KDTree(path_points)
        end = tuple(path_points[kdtree.query(end_pos)[1]])

        path_points = np.vstack(np.where(labeled_path == labeled_path[alt_start])).T
        kdtree = KDTree(path_points)
        alt_end = tuple(path_points[kdtree.query(start_pos)[1]])
        
        if math.dist(end, end_pos) < math.dist(alt_end, start_pos):
            route = np.array(nx.dijkstra_path(self.graph, start, end))
            reversed_targets = False
        else:
           route = np.array(nx.dijkstra_path(self.graph, alt_start, alt_end))
           reversed_targets = True

        return (route, reversed_targets)
    
    def draw_path(self, weight=3, opacity=0.2):
        base = self.original_img.copy()
        overlay = np.zeros(self.original_img.shape)
        alpha = self.path.copy()

        alpha = np.float32(binary_dilation(alpha, structure=disk(weight//2)))
        alpha *= opacity

        alpha = np.repeat(alpha, 3).reshape(base.shape)

        return np.uint8(alpha*overlay + (-1*alpha+1)*base)



if __name__	== "__main__":
    import matplotlib.pyplot as plt

    route_finder = RouteFinder(cv2.imread(
        r"C:\Users\rb\Documents\Python\RouteFinder\zoo_plan.png"
    ))
    route_finder.crop_img([
        (6, 263), (279, 833), (82, 1008), (189, 1147), (382, 1110),
        (267, 918), (601, 939), (730, 491), (688, 215), (443, 4)
    ])
    route_finder.preprocess()
    # zoo_plan.png: 460 710
    # park_plan.png: 150 730
    route_finder.get_path((460, 710))
    route_finder.clean_path()
    route_finder.close_gaps()
    route_finder.get_graph_from_path()

    # 200 340
    # 510 750
    route, _ = route_finder.find_route((690, 580), (200, 340))

    out = cv2.cvtColor(route_finder.draw_path(), cv2.COLOR_BGR2RGB)
    out[route[:, 0], route[:, 1]] = [0, 255, 0]
    plt.imshow(out)
    plt.show()