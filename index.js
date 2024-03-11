const express = require('express')
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const { User } = require('./models/User');
const bodyParser = require("body-parser");
const config = require("./config/key");
const { auth } = require("./middleware/auth");
const { spawn } = require('child_process');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const fetch = require('node-fetch');
const port = 3000

const app = express();

app.use(cors());
const corsOptions = {
  origin: 'http://localhost:3000',
  credentials: true, // 쿠키를 허용하기 위해 필요
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

app.use(express.urlencoded({ extended: true }));

// 에러 핸들링 미들웨어 추가
app.use((err, req, res, next) => {
  console.error(err.stack); // 에러 로깅

  // 클라이언트에게 전달할 에러 메시지 설정
  const errorMessage = '서버 에러 발생, 죄송합니다!';

  // 클라이언트에게 적절한 에러 응답을 전송
  res.status(500).json({
    success: false,
    message: errorMessage,
    error: err.message // 에러 메시지를 전달하거나 필요한 경우 추가 정보 제공 가능
  });
});

//mongoDB서버에 연결
mongoose
  .connect(config.mongoURI)
  .then(() => console.log("MongoDB 연결 성공..."))
  .catch((err) => console.log(err));

//스키마 & 모델 회원가입 구현
app.post("/api/users/register", (req, res) => {
  //회원가입할 때 필요한 정보들을 받아와 데이터베이스에 넣어줌
  const user = new User(req.body);
  console.log("--------회원가입---------")
  console.log("회원가입 중")
  user.save()
    .then((userInfo) => {
      console.log("회원가입 성공")
      return res.status(200).json({ success: true, userInfo: userInfo });
    })
    .catch((err) => {
      console.log("회원가입 실패")
      console.log(err)
      return res.json({ success: false, err });
    });
});

app.post("/api/users/login", async (req, res) => {
  const { email, password } = req.body;
  console.log("--------로그인 중----------")
  console.log("입력한 email:", email)
  console.log("입력한 password:", password)
  try {
    // DB에서 요청한 ID 찾기
    const user = await User.findOne({ email: email });
    console.log("DB 확인중");
    if (!user) {
      console.log("ID 불일치")
      return res.json({
        success: false,
        message: "ID를 다시 확인하세요.",
      });
    }
    console.log("ID 존재 ")
    // DB에 요청한 ID가 있다면 비밀번호가 같은지 확인
    const isMatch = await user.comparePassword(password);
    console.log('isMatch', isMatch);
    if (!isMatch) {
      console.log("비밀번호 불일치")
      return res.json({
        success: false,
        message: "비밀번호가 틀렸습니다",
      });
    }
    console.log("비밀번호 일치")
    // 비밀번호가 같다면 Token 생성
    const tokenUser = await user.generateToken();

    if (!tokenUser || !tokenUser.token) {
      throw new Error("토큰 생성 중 에러: 유효한 토큰이 반환되지 않았습니다.");
    }
    // 생성된 토큰을 쿠키에 저장
    console.log("토큰을 쿠키에 저장함")
    res
      .cookie("x_auth", tokenUser.token)
      .status(200)
      .json({ success: true, userId: tokenUser._id });

  } catch (err) {
    // 에러 발생 시 처리
    console.error("로그인 중 에러:", err);
    res.status(400).json({ success: false, message: "로그인 중 에러", error: err });
  }
});

//앱에서 기능에 접근 시 권한(토큰 일치 여부) 확인
app.get("/api/users/auth", auth, (req, res) => {
  console.log("---------권한 확인중---------")
  //req.user에 user값을 넣어줬으므로
  res.status(200).json({
    _id: req.user._id,
    email: req.user.email,
    isAuth: true,
  });
});

// 일일 적정 칼로리 섭취량 계산
app.get("/api/users/calories", auth, async (req, res) => {
  console.log("------일일적정칼로리량 계산중-------")

  try {
    const user = await User.findOne({ _id: req.user._id }, 'high gender name').exec();
    console.log("DB 확인중");
    if (!user) {
      return res.status(404).json({
        success: false, message: "사용자를 찾을 수 없음"
      });
    }
    const { high, gender, name } = user;
    const userHigh = parseInt(high);
    console.log("키:", high, "성별: ", gender, "이름: ", name)
    let calories = 0;

    if (gender === "여성") {
      calories = Math.round(((userHigh ** 2) * 21 / 10000) * 30);
    } else if (gender === "남성") {
      calories = Math.round(((userHigh ** 2) * 22 / 10000) * 30);
    } else {
      return res.status(400).json({
        success: false, message: "잘못된 성별 정보"
      });
    }
    console.log("일일 적정 섭취 칼로리량: ", calories, name)
    return res.status(200).json({ success: true, calories, name });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

//업로드한 이미지 저장
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './uploads/');
  },
  filename: function (req, file, cb) {
    // 파일 이름 설정
    cb(null, 'image-' + Date.now() + path.extname(file.originalname) + '.jpg');
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    // 파일 MIME 타입을 통해 확장자 확인
    if (
      file.mimetype === 'image/jpeg' ||
      file.mimetype === 'image/jpg' ||
      file.mimetype === 'image/png'
    ) {
      // 허용되는 확장자일 경우
      console.log('업로드 된이미지 확장자: ', file.mimetype)
      cb(null, true);
    } else {
      // 허용되지 않는 확장자일 경우
      cb(new Error('jpg, jpeg, png 파일을 올려주세요!'), false);
    }
  }
});

//데베 연결
const db = new sqlite3.Database('foodmanager.db', (err) => {
  if (err) {
    console.log('데이터베이스 연결에 실패함', err)
  } else {
    console.log('foodmanager.db에 연결됨')
    updateDatabase(); // 서버 시작 시 데이터베이스 업데이트 호출
  }
})
//데이터베이스 업데이트 
const jsonFilePath = 'C:/api/food_data.json';
const rawData = fs.readFileSync(jsonFilePath, 'utf8');
const jsonData = JSON.parse(rawData);

function updateDatabase() {
  const insertOrUpdateQuery = `INSERT INTO Food (Name, EnglishName, Calories, Category, Quantity) VALUES (?, ?, ?, ?, ?) ON CONFLICT(Name) DO UPDATE SET EnglishName = ?, Calories = ?, Category = ?, Quantity = ?`;
  jsonData.forEach((item) => {
    db.run(insertOrUpdateQuery, [item.Name, item.EnglishName || null, item.Calories, item.Category, item.Quantity, item.EnglishName || null, item.Calories, item.Category, item.Quantity], (err) => {
      if (err) { console.error("Error updating database: ", err.message); }
    });
  });
  console.log("데이터베이스 업데이트 성공");
}

//사진 등록-> 이미지처리
app.post("/api/upload/image", upload.single('image'), async (req, res) => {
  console.log("----------사진 등록-----------")
  // console.log('1',req.body.file);
  if (!req.file.path) {
    console.log('파일이 업로드 되지 않음')
    return res.status(400).json('파일이 업로드 되지 않음');
  }

  const imagePath = req.file.path;
  //console.log("이미지 경로: ", imagePath);

  // 이미지 처리
  const pythonScriptPath = 'C:/api/middleware/processing.py';
  const pythonProcess = spawn('python', [pythonScriptPath, imagePath]);

  // 음식을 식별하고 음식 이름을 추출하는 함수
  let resultData = '';
  pythonProcess.stdout.on('data', (data) => {
    resultData += data.toString();
  })

  pythonProcess.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  //파이썬 스크립트에서 출력한 json 데이터 파싱
  pythonProcess.stdout.on('data', (data) => {
    try {
      const resultString = data.toString('utf8');
      const result = JSON.parse(resultString);

      //추출받은 음식 파싱
      const detectedFoods = result.detections.map(det => det.label);

      //데베에서 음식 정보 가져옴
      const foodPromises = detectedFoods.map((foodLabel) => {
        return new Promise((resolve, reject) => {
          db.get(
            'SELECT Name, Calories, Quantity FROM Food WHERE EnglishName = ?',
            [foodLabel],
            (err, row) => {
              if (err) {
                reject(err.message);
              } else {
                resolve(row);
              }
            }
          );
        });
      });
      //모든 음식 정보를 가져온 후 클라이언트에게 전송
      Promise.all(foodPromises)
        // .then ((foodInfo.length === 0) => {
        //   console.log('감지된 객체 없음');
        //   res.status(400).json({ error });
        // })
        .then((foodInfo) => {
          console.log('length', foodInfo.length);
          if (foodInfo.length === 0) {
            res.status(500).json({ error });
          }
          console.log(detectedFoods, foodInfo)
          res.json({ detectedFoods, foodInfo });
        })
        .catch((error) => {
          console.error('데이터베이스 오류:', error);
          res.status(500).json({ error });
        });
    } catch (error) {
      console.error('파싱 에러:', error);
      res.status(500).json({ message: '파싱 에러' });
    }
  });

  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      console.log(`파이썬 스크립트 종료 코드: ${code}`);
      return res.status(500).json({ message: '파이썬 스크립트 실행 에러' });
    }
  })
})
//식단 등록
app.post("/api/users/recordMeal", auth, async (req, res) => {
  console.log("---------식단 저장---------");
  // const { date, mealType, foodIDs } = req.body;
  const date = req.body.selectedDate;
  const mealType = req.body.receivedType;
  const foodIDs = req.body.selectedFoods;
  const user = await User.findOne({ _id: req.user._id, email: req.user.email });
  console.log(date)
  try {
    const insertQuery = `INSERT INTO MealRecord (UserID, Date, MealType, FoodID) VALUES (?, ?, ?, ?)`;
    const foodInfoQuery = `SELECT MealRecord.FoodID, Food.Calories, Food.Quantity 
      FROM MealRecord INNER JOIN Food ON MealRecord.FoodID = Food.Name 
      WHERE MealRecord.UserID = ? AND MealRecord.Date = ? AND MealRecord.MealType = ?`;
    const promises = [];
    console.log("id: ", user.email);
    console.log("날짜: ", date, "/ 식사 유형: ", mealType);
    foodIDs.forEach((foodID) => {
      const promise = new Promise((resolve, reject) => {
        db.run(insertQuery, [user.email, date, mealType, foodID], function (err) {
          if (err) {
            console.log('식사 등록 에러', err);
            reject(err);
          } else {
            console.log(`${foodID}을(를) MealRecord에 등록 성공`);
            resolve();
          }
        });
      });
      promises.push(promise);
    });

    Promise.all(promises)
      .then(async () => {
        try {
          const rows = await new Promise((resolve, reject) => {
            db.all(foodInfoQuery, [user.email, date, mealType], function (err, rows) {
              if (err) {
                console.error('음식 정보 조회 에러:', err);
                reject(err);
              } else {
                console.log('음식 정보 조회 성공:', rows);
                resolve(rows);
              }
            });
          });

          const totalCalories = rows.reduce((acc, row) => acc + row.Calories, 0);

          console.log('총 칼로리량:', totalCalories);
          res.status(201).json({ rows, totalCalories });
        } catch (error) {
          console.log('먹은/남은 칼로리 조회 에러:', error);
          res.status(500).json({ error });
        }
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({ message: '식사 등록 에러1', err });
      });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: '식사 등록 에러2', error });
  }
});

//캘린더
app.post("/api/users/calendar", auth, async (req, res) => {
  console.log("----------캘린더-----------")
  const date = req.body.date;
  const dateI = req.body.selectedDate;
  const user = await User.findOne({ _id: req.user._id, email: req.user.email })
  console.log(req.body)
  if (date) {
    try {
      db.all(
        `SELECT MealRecord.MealType, MealRecord.FoodID, Food.Calories, Food.Quantity 
        FROM MealRecord 
        INNER JOIN Food ON MealRecord.FoodID = Food.Name 
        WHERE MealRecord.UserID = ? AND MealRecord.Date = ?`,
        [user.email, date], //email(id)과 날짜로 음식 정보를 찾아옴
        function (err, rows) {
          if (err) {
            console.log('데이터 조회 중 에러 발생: ', err);
            return res.status(500).json({ success: false, err });
          }
          if (!rows || rows.length === 0) {
            console.log('해당 날짜: ', date, '에 대한 정보가 없습니다.');
            return res.status(404).json({ success: false });
          }
          const totalCalories = rows.reduce((acc, row) => acc + row.Calories, 0);
          console.log('데이터 조회 성공: ', rows)
          console.log('날짜: ', date)
          console.log('총 칼로리량:', totalCalories)
          res.status(200).json({ success: true, data: rows, totalCalories });
        });
    } catch (err) {
      console.log('에러 발생: ', err);
      res.status(500).json({ success: false, err });
    }
  }
  if (dateI) {
    try {
      db.all(
        `SELECT MealRecord.MealType, MealRecord.FoodID, Food.Calories, Food.Quantity 
        FROM MealRecord 
        INNER JOIN Food ON MealRecord.FoodID = Food.Name 
        WHERE MealRecord.UserID = ? AND MealRecord.Date = ?`,
        [user.email, dateI], //email(id)과 날짜로 음식 정보를 찾아옴
        function (err, rows) {
          if (err) {
            console.log('데이터 조회 중 에러 발생: ', err);
            return res.status(500).json({ success: false, err });
          }
          if (!rows || rows.length === 0) {
            console.log('해당 날짜: ', date, '에 대한 정보가 없습니다.');
            return res.status(404).json({ success: false });
          }
          const totalCalories = rows.reduce((acc, row) => acc + row.Calories, 0);
          console.log('데이터 조회 성공: ', rows)
          console.log('날짜: ', dateI)
          console.log('총 칼로리량:', totalCalories)
          res.status(200).json({ success: true, data: rows, totalCalories });
        });
    } catch (err) {
      console.log('에러 발생: ', err);
      res.status(500).json({ success: false, err });
    }
  }

})
//식단 등록 후 칼로리 
app.get("/api/users/remainingCalories", auth, async (req, res) => {
  const user = await User.findOne({ _id: req.user._id });
  const date = new Date(new Date().getTime() + (9 * 60 * 60 * 1000)).toISOString().split('T')[0]; // 현재 날짜를 ISO 형식으로 가져옴 (YYYY-MM-DD)
  try {
    // /api/users/recordMeal로부터 받은 응답 데이터 가져오기
    const calendarResponse = await fetch('http://localhost:3000/api/users/calendar',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        }, //권한 접근
        body: JSON.stringify({ date })
      })
    const caloriesResponse = await fetch('http://localhost:3000/api/users/calories',
      {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        } //권한 접근
      })
    const calendarData = await calendarResponse.json();
    console.log('페치 다음: ', calendarData.totalCalories)
    const caloriesData = await caloriesResponse.json();
    // recordMeal에서 dailyCalories, totalCalories 가져와서 남은 칼로리 계산
    const eatenCalories = calendarData.totalCalories;
    const calories = caloriesData.calories;
    const remainingCalories = calories - eatenCalories;
    // 남은 칼로리 정보 응답
    console.log("eatenCalories:", eatenCalories, "remainingCalories:", remainingCalories)
    res.status(200).json({ eatenCalories: eatenCalories, remainingCalories: remainingCalories });
  } catch (error) {
    console.log('남은 칼로리 조회 에러:', error);
    res.status(500).json({ error });
  }
});

app.get("/api/users/recommend", auth, async (req, res) => {
  const remainResponse = await fetch('http://localhost:3000/api/users/remainingCalories',
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${user.token}`
      } //권한 접근
    })
  const remainData = await remainResponse.json;
  const remain = remainData.remainingCalories
  console.log(remain)

  try {
    db.all(
      //Food Table에서 remain보다 작은 Calories에 해당하는
      //Food.Name, Food.Calories, Food Quantity를 불러옴
      `SELECT Name, Calories, Quantity 
          FROM Food WHERE Calories < ?`,
      [remainingCalories],
      (err, rows) => {
        if (err) {
          console.log('데이터 조회 중 에러 발생: ', err);
          return res.status(500).json({ success: false, err });
        }
        console.log(rows)
        res.status(200).json({ success: true, rows });
      });
  } catch (err) {
    console.log('페치 에러 발생: ', err);
    res.status(500).json({ success: false, err: '페치에러' });
  }
})
//데이터베이스 연결 종료
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      return console.error(err.message);
    }
    console.log('데이터베이스 연결 종료');
    process.exit(0);
  });
});
//회원정보
app.get("/api/users/info", auth, async (req, res) => {
  const user = await User.findOne({ _id: req.user._id }, 'name high kg gender')
  if (!user) {
    return res.status(404).json({
      success: false, message: "사용자를 찾을 수 없음"
    });
  }
  console.log("----------회원정보----------")
  console.log('name: ', user.name)
  console.log('high: ', user.high)
  console.log('kg: ', user.kg)
  console.log('gender: ', user.gender)
  //req.user에 user값을 넣어줬으므로
  res.status(200).json({
    name: user.name,
    high: user.high,
    kg: user.kg,
    gender: user.gender
  });
})
//로그아웃
app.get("/api/users/logout", auth, async (req, res) => {
  console.log("---------로그아웃----------")
  try {
    const user = await User.findOneAndUpdate({ _id: req.user._id }, { $unset: { token: "" } }).exec();
    if (!user) {
      return res.status(404).json({
        success: false, message: "사용자 없음"
      });
    }
    res.clearCookie("x_auth");
    console.log('로그아웃 성공')
    return res.status(200).send({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});