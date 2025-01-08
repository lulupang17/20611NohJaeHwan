const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const cors = require("cors")({ origin: true });


admin.initializeApp();


const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: functions.config().email.user, 
        pass: functions.config().email.pass,
    },
});


console.log("Configured Email User:", functions.config().email.user);


exports.checkInactiveUsers = functions.pubsub.schedule("every 24 hours").onRun(async (context) => {
    const db = admin.database();
    const usersRef = db.ref("users");

    const today = new Date();
    const snapshot = await usersRef.once("value");
    const usersToNotify = [];

    snapshot.forEach((userSnapshot) => {
        const userData = userSnapshot.val();
        const lastAttendanceDate = new Date(userData.lastAttendanceDate);
        const diffTime = today - lastAttendanceDate;


        if (userData.receiveAlerts && !isNaN(lastAttendanceDate) && diffTime > 3 * 24 * 60 * 60 * 1000) {
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            usersToNotify.push({
                id: userSnapshot.key,
                diffDays,
                ...userData,
            });
        }
    });

    if (usersToNotify.length > 0) {
        console.log("3일 이상 출석하지 않은 사용자:", usersToNotify);
        await sendNotifications(usersToNotify);
    }

    return null;
});


async function sendNotifications(users) {
    for (const user of users) {
        const mailOptions = {
            from: functions.config().email.user,
            to: user.guardianEmail,
            subject: "노인들을 위한 출석체크 알림",
            text: generateEmailContent(user),
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log(`알림 이메일 전송 성공: ${user.guardianEmail}`);
        } catch (error) {
            console.error(`알림 이메일 전송 실패 (${user.guardianEmail}):`, error);
        }
    }
}


function generateEmailContent(user) {
    return `
안녕하세요 노인들을 위한 출석체크에서 알려드립니다.

${user.name}님께서 최근 ${user.diffDays}일 동안 출석하지 않았습니다.
마지막 출석일: ${user.lastAttendanceDate}
현재 ${user.name}님께서 위험한 상황일수도 있으니 확인해시는것을 추천드립니다.

회원정보:
- 이름: ${user.name}
- 아이디: ${user.username}
- 보유 병명: ${user.disease || "없음"}

만약 이 알림 수신을 중단하고 싶으시다면
https://attendance-check-for-elder.firebaseapp.com 으로 접속하셔서
${user.name}님의 계정으로 로그인하신 뒤,
회원정보 수정 > 알림 서비스 중단을 선택하시면 됩니다.
    `;
}


exports.sendTestAlert = functions.https.onRequest((req, res) => {
    cors(req, res, async () => {
        const userId = req.query.userId || (req.body && req.body.userId);

        if (!userId) {
            return res.status(400).send("사용자 ID가 필요합니다.");
        }

        try {
            const db = admin.database();
            const userRef = db.ref(`users/${userId}`);
            const snapshot = await userRef.once("value");

            if (!snapshot.exists()) {
                return res.status(404).send("사용자를 찾을 수 없습니다.");
            }

            const userData = snapshot.val();
            const lastAttendanceDate = new Date(userData.lastAttendanceDate);
            const diffDays = !isNaN(lastAttendanceDate)
                ? Math.floor((new Date() - lastAttendanceDate) / (1000 * 60 * 60 * 24))
                : "N/A";

            const mailOptions = {
                from: functions.config().email.user,
                to: userData.guardianEmail,
                subject: "테스트 알림: 노인들을 위한 출석체크",
                text: `
안녕하세요 노인들을 위한 출석체크에서 알려드립니다.
이 메세지는 테스트 입니다.

${userData.name}님께서 최근 ${diffDays}일 동안 출석하지 않았습니다.
마지막 출석일: ${userData.lastAttendanceDate}
현재 ${userData.name}님께서 위험한 상황일수도 있으니 확인해시는것을 추천드립니다.

회원정보:
- 이름: ${userData.name}
- 아이디: ${userData.username}
- 보유 병명: ${userData.disease || "없음"}

만약 이 알림 수신을 중단하고 싶으시다면
https://attendance-check-for-elder.firebaseapp.com 으로 접속하셔서
${userData.name}님의 계정으로 로그인하신 뒤,
회원정보 수정 > 알림 서비스 중단을 선택하시면 됩니다.
                `,
            };

            await transporter.sendMail(mailOptions);
            console.log(`테스트 이메일 전송 성공: ${userData.guardianEmail}`);
            res.status(200).send("테스트 이메일 전송 성공");
        } catch (error) {
            console.error("테스트 이메일 전송 실패:", error);
            res.status(500).send("테스트 이메일 전송 실패");
        }
    });
});




