import { createSlice } from "@reduxjs/toolkit";

const sessionSlice = createSlice({
  name: "session",
  initialState: { expired: false },
  reducers: {
    sessionExpired(state) { state.expired = true; },
    sessionRestored(state) { state.expired = false; },
  },
});

export const { sessionExpired, sessionRestored } = sessionSlice.actions;
export default sessionSlice.reducer;
