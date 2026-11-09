import {
    BrowserRouter,
    Routes,
    Route
} from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Catalog from "./pages/Catalog";
import Metrics from "./pages/Metrics";

import ProtectedRoute from "./components/ProtectedRoute";


export default function App() {

    return (
        <BrowserRouter>

            <Routes>

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
                    path="/metrics"
                    element={
                        <ProtectedRoute>
                            <Metrics />
                        </ProtectedRoute>
                    }
                />

            </Routes>

        </BrowserRouter>
    );
}