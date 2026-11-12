import {
    Routes,
    Route,
    Navigate
} from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Catalog from "./pages/Catalog";
import Upload from "./pages/Upload";
import MySongs from "./pages/MySongs";
import Playlists from "./pages/Playlists";
import Playlist from "./pages/Playlist";
import Metrics from "./pages/Metrics";
import Rooms from "./pages/Rooms";
import Room from "./pages/Room";
import Notifications from "./pages/Notifications";

import ProtectedRoute from "./components/ProtectedRoute";

export default function App() {
    return (
        <Routes>

            <Route
                path="/"
                element={
                    <ProtectedRoute>
                        <Navigate to="/catalog" replace />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/login"
                element={<Login />}
            />

            <Route
                path="/register"
                element={<Register />}
            />

            <Route
                path="/catalog"
                element={
                    <ProtectedRoute>
                        <Catalog />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/upload"
                element={
                    <ProtectedRoute>
                        <Upload />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/my-songs"
                element={
                    <ProtectedRoute>
                        <MySongs />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/playlists"
                element={
                    <ProtectedRoute>
                        <Playlists />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/playlists/:playlistId"
                element={
                    <ProtectedRoute>
                        <Playlist />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/metrics"
                element={
                    <ProtectedRoute>
                        <Metrics />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/rooms"
                element={
                    <ProtectedRoute>
                        <Rooms />
                    </ProtectedRoute>
                }
            />

            <Route
                path="/rooms/:roomId"
                element={
                    <ProtectedRoute>
                        <Room />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/notifications"
                element={
                    <ProtectedRoute>
                        <Notifications />
                    </ProtectedRoute>
                }
/>

            <Route
                path="*"
                element={<Navigate to="/" replace />}
            />

        </Routes>
    );
}
