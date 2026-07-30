const jwt = require("jsonwebtoken");

const login = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      success: false,
      message: "Username and password are required",
    });
  }

  if (
    username !== process.env.STATIC_USERNAME ||
    password !== process.env.STATIC_PASSWORD
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid username or password",
    });
  }

  const token = jwt.sign(
    {
      username,
      role: "admin",
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "1d",
    }
  );

  return res.status(200).json({
    success: true,
    message: "Login successful",
    token,
    user: {
      username,
      role: "admin",
    },
  });
};

module.exports = {
  login,
};